"""Cross-tree bridge linking and drift resolution between two members."""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_writable_tree
from app.db.session import get_db
from app.models import Member, Tree
from app.models.user import User
from app.schemas.family import BridgeSyncRequest, MemberLinkRequest, MemberOut
from app.schemas.merge import DuplicatePair, LinkCandidatesOut
from app.schemas.tree import MemberSubtreeOut, TreeOut
from app.services import feature_service
from app.services.activity.activity import record_activity
from app.services.bridge import copy_bridge_fields, validate_linked_tree
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_tree_event
from app.services.member_access import get_member
from app.services.member_clone import (
    clone_member,
    compute_conflicts,
    member_key,
    member_name_key,
    reconcile_bridge_fields,
    wire_bridge,
)
from app.services.tree_roles import role_for

router = APIRouter(prefix="/trees/{tree_id}", tags=["members"])


@router.get(
    "/members/{member_id}/link-candidates",
    response_model=LinkCandidatesOut,
)
def get_link_candidates(
    member_id: str,
    target_tree_id: str = Query(...),
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List same-named members of ``target_tree_id`` that could be the bridge
    counterpart for ``member_id`` — i.e. candidates for ``POST .../link``
    with ``mode="existing"``.

    Only members matching the source member's name+gender key are returned
    (a bridge person is the same human on both sides, so an unrelated match
    would be meaningless), excluding the source member itself and anyone
    already linked to another tree. Each candidate is shaped as a
    ``DuplicatePair`` (reusing the tree-merge machinery) so the client can
    render the same conflict-resolution UI merge already uses.
    """
    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    member = get_member(db, tree, member_id)

    validate_linked_tree(db, tree, user, target_tree_id)
    target = db.get(Tree, target_tree_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Linked tree not found")
    # Candidates are only useful if the caller can actually link one, which
    # requires write access to the target (same check the link endpoint uses).
    if not user.is_admin and role_for(db, target, user) not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="No write access to the linked tree")

    source_name_key = member_name_key(member)
    source_exact_key = member_key(member)
    candidates: list[DuplicatePair] = []
    for candidate in db.scalars(select(Member).where(Member.tree_id == target.id)):
        if candidate.id == member.id:
            continue
        if candidate.linked_tree_id is not None:
            continue
        if member_name_key(candidate) != source_name_key:
            continue
        match = "exact" if member_key(candidate) == source_exact_key else "possible"
        candidates.append(
            DuplicatePair(
                member_a=MemberOut.model_validate(member),
                member_b=MemberOut.model_validate(candidate),
                match=match,
                conflicts=compute_conflicts(member, candidate),
                default_action="merge",
            )
        )
    return LinkCandidatesOut(candidates=candidates)


@router.post(
    "/members/{member_id}/link",
    response_model=MemberSubtreeOut,
    status_code=201,
)
def link_member_to_tree(
    member_id: str,
    payload: MemberLinkRequest,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Establish a tree-in-tree bridge between this member and a target tree.

    Unlike ``PATCH /members/{id}`` (which can only clear a link, never create
    one — see the loophole this closes), this endpoint always resolves a real
    bridge person on both sides: either an existing member the caller asserts
    is the same person (``mode="existing"``), or a fresh clone seeded into the
    target tree (``mode="create"``). Establishing a link writes rows in two
    trees, so it requires write access to both.
    """
    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    member = get_member(db, tree, member_id)
    if member.linked_tree_id is not None:
        raise HTTPException(status_code=409, detail="Member is already linked to a tree")

    validate_linked_tree(db, tree, user, payload.linked_tree_id)
    target = db.get(Tree, payload.linked_tree_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Linked tree not found")
    # Establishing a bridge writes the counterpart row too, so read access to
    # the target (already checked by validate_linked_tree) is not enough.
    if not user.is_admin and role_for(db, target, user) not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="No write access to the linked tree")

    if payload.mode == "create":
        counterpart = clone_member(member, target.id, str(uuid4()))
        counterpart.position_x = 0
        counterpart.position_y = 0
        counterpart.is_collapsed = False
        db.add(counterpart)
        db.flush()
    else:
        if payload.counterpart_member_id is None:
            raise HTTPException(
                status_code=400,
                detail="counterpart_member_id is required for mode=existing",
            )
        counterpart = db.get(Member, payload.counterpart_member_id)
        if counterpart is None or counterpart.tree_id != target.id:
            raise HTTPException(
                status_code=400,
                detail="Counterpart member is not part of the linked tree",
            )
        if counterpart.id == member.id:
            raise HTTPException(status_code=400, detail="A member cannot link to itself")
        if counterpart.linked_tree_id is not None:
            raise HTTPException(
                status_code=400,
                detail="Counterpart member is already linked to a tree",
            )

    wire_bridge(member, counterpart)
    if payload.mode == "existing":
        # The two rows may describe the same person with differing details
        # (dates, places, notes, ...) — reconcile them onto both sides now
        # rather than letting the bridge start out of sync. field_choices is
        # ignored for mode="create": the counterpart there is a fresh clone of
        # `member`, so there is nothing to reconcile.
        reconcile_bridge_fields(member, counterpart, payload.field_choices)

    label = " ".join(filter(None, [member.first_name, member.last_name])) or None
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="update",
        target_type="member",
        target_id=member.id,
        target_label=label,
        details={"after": {"linked_tree_id": target.id}},
    )
    counterpart_label = (
        " ".join(filter(None, [counterpart.first_name, counterpart.last_name])) or None
    )
    if payload.mode == "create":
        record_activity(
            db,
            tree_id=target.id,
            actor=user,
            action="create",
            target_type="member",
            target_id=counterpart.id,
            target_label=counterpart_label,
        )
    else:
        record_activity(
            db,
            tree_id=target.id,
            actor=user,
            action="update",
            target_type="member",
            target_id=counterpart.id,
            target_label=counterpart_label,
            details={"after": {"linked_tree_id": tree.id}},
        )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    publish_tree_event(db, target, "activity.entry_added", {"tree_id": target.id})
    db.refresh(member)
    db.refresh(target)
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    invalidate_stats(tree.id)
    publish_tree_event(
        db,
        target,
        "tree.content_changed",
        {"tree_id": target.id, "domain": "member"},
    )
    invalidate_stats(target.id)
    return MemberSubtreeOut(
        tree=TreeOut.model_validate(target),
        anchor=MemberOut.model_validate(member),
    )


@router.post("/members/{member_id}/bridge-sync", response_model=MemberOut)
def resolve_bridge_drift(
    member_id: str,
    payload: BridgeSyncRequest,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve bridge-person drift by copying person-level fields across the
    link: ``push`` writes this member's values onto the counterpart, ``pull``
    adopts the counterpart's values. Requires write access to both trees.
    """
    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    member = get_member(db, tree, member_id)
    if member.linked_member_id is None:
        raise HTTPException(status_code=400, detail="Member has no linked member")
    counterpart = db.get(Member, member.linked_member_id)
    if counterpart is None:
        raise HTTPException(status_code=404, detail="Linked member not found")
    other_tree = db.get(Tree, counterpart.tree_id)
    if other_tree is None:
        raise HTTPException(status_code=404, detail="Linked tree not found")
    if not user.is_admin and role_for(db, other_tree, user) not in (
        "owner",
        "editor",
    ):
        raise HTTPException(status_code=403, detail="No write access to linked tree")

    src, dst = (
        (member, counterpart) if payload.direction == "push" else (counterpart, member)
    )
    copy_bridge_fields(src, dst)

    label = " ".join(filter(None, [member.first_name, member.last_name])) or None
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="update",
        target_type="member",
        target_id=member.id,
        target_label=label,
        details={"after": {"bridge_sync": payload.direction}},
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(member)
    for t in (tree, other_tree):
        publish_tree_event(
            db,
            t,
            "tree.content_changed",
            {"tree_id": t.id, "domain": "member"},
        )
        invalidate_stats(t.id)
    return member
