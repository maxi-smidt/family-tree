"""Members, relations and diseases — all scoped to a tree."""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_current_user_optional,
    get_readable_tree,
    get_readable_tree_public,
    get_writable_tree,
    require_domain,
    role_for,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import (
    Event,
    EventMemberLink,
    Member,
    MemberDisease,
    Relation,
    RelationType,
    Tree,
    TreeMembership,
)
from app.models.user import User
from app.schemas.family import (
    BridgeSyncRequest,
    DiseaseCreate,
    DiseaseOut,
    DiseaseUpdate,
    MemberCollapsedUpdate,
    MemberCreate,
    MemberLinkRequest,
    MemberOut,
    MemberPositionUpdate,
    MemberSubtreeCreate,
    MemberSubtreeOut,
    MemberSurfaceOut,
    MemberUpdate,
    NeighborhoodOut,
    PublicMemberOut,
    RelationCreate,
    RelationOut,
)
from app.schemas.merge import DuplicatePair, LinkCandidatesOut
from app.schemas.tree import TreeOut
from app.services.activity import record_activity
from app.services.bridge import BRIDGE_SYNC_FIELDS, copy_bridge_fields
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_tree_event
from app.services.member_subtrees import create_linked_subtree
from app.services.neighborhood import collect_neighborhood_ids, pick_default_root
from app.services.settings_service import get_media_limits
from app.services.storage import (
    MEDIA_URL_PREFIX,
    ImageTooLarge,
    UnsupportedImageType,
    copy_media_to_tree,
    delete_media,
    process_image_field,
)
from app.services.storage_usage import QuotaExceeded, check_media_quota, check_tree_quota

router = APIRouter(prefix="/trees/{tree_id}", tags=["members"])

# Columns selected for the lightweight "surface" projection (everything in
# MemberSurfaceOut). Shared by the member list, search and neighborhood
# endpoints so the three stay in lockstep. The heavier detail field
# (additional_data) stays deferred to the per-member fetch.
_MEMBER_SURFACE_COLUMNS = (
    Member.id,
    Member.gender,
    Member.academic_title,
    Member.first_name,
    Member.middle_names,
    Member.baptismal_name,
    Member.last_name,
    Member.maiden_name,
    Member.image_data,
    Member.date_of_birth,
    Member.date_of_death,
    Member.date_of_birth_sort,
    Member.date_of_death_sort,
    Member.deceased,
    Member.birthplace,
    Member.hometown,
    Member.cemetery,
    Member.places_lived,
    Member.is_collapsed,
    Member.position_x,
    Member.position_y,
    Member.linked_tree_id,
    Member.linked_member_id,
)

_PUBLIC_MEMBER_COLUMNS = (
    Member.id,
    Member.gender,
    Member.academic_title,
    Member.first_name,
    Member.middle_names,
    Member.baptismal_name,
    Member.last_name,
    Member.maiden_name,
    Member.image_data,
    Member.date_of_birth,
    Member.date_of_death,
    Member.deceased,
    Member.is_collapsed,
    Member.position_x,
    Member.position_y,
)


def _public_only(db: Session, tree: Tree, user: User | None) -> bool:
    return user is None or (not user.is_admin and role_for(db, tree, user) is None)


def _public_member_payloads(rows: list) -> list[dict]:
    return [PublicMemberOut(**row._mapping).model_dump(by_alias=True) for row in rows]


def _get_member(db: Session, tree: Tree, member_id: str) -> Member:
    member = db.get(Member, member_id)
    if member is None or member.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Member not found")
    return member


def _validate_linked_tree(
    db: Session, tree: Tree, user: User, linked_tree_id: str | None
) -> None:
    """Validate a tree-in-tree link target before it is persisted.

    A null id (clearing the link) is always allowed. Otherwise the ``tree_links``
    feature must be enabled, the target must exist and be readable by the user,
    and a member may not link to its own tree.
    """
    if linked_tree_id is None:
        return
    from app.services import feature_service  # noqa: PLC0415

    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    if linked_tree_id == tree.id:
        raise HTTPException(
            status_code=400, detail="A member cannot link to its own tree"
        )
    target = db.get(Tree, linked_tree_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Linked tree not found")
    if (
        not user.is_admin
        and role_for(db, target, user) is None
        and target.public_role != "viewer"
    ):
        raise HTTPException(status_code=403, detail="No access to linked tree")


def _validate_linked_member(
    db: Session,
    linked_tree_id: str | None,
    linked_member_id: str | None,
    member_id: str | None,
) -> None:
    """Validate the member-level counterpart of a tree-in-tree link.

    ``linked_member_id`` identifies the row in the linked tree that represents
    the same person (the bridge person), so it must live inside
    ``linked_tree_id``. Access is already covered by ``_validate_linked_tree``.
    """
    if linked_member_id is None:
        return
    if linked_tree_id is None:
        raise HTTPException(
            status_code=400,
            detail="A linked member requires a linked tree",
        )
    if linked_member_id == member_id:
        raise HTTPException(status_code=400, detail="A member cannot link to itself")
    target = db.get(Member, linked_member_id)
    if target is None or target.tree_id != linked_tree_id:
        raise HTTPException(
            status_code=400,
            detail="Linked member is not part of the linked tree",
        )


def _sync_bridge_person(
    db: Session, member: Member, changes: dict, user: User
) -> tuple[str | None, Tree | None]:
    """Mirror identity-field edits onto the counterpart row of a bridge person.

    The two rows represent the same human, so person-level facts edited on one
    side propagate to the other — but only while the tree_links feature is
    enabled and the actor may write the counterpart's tree; otherwise the rows
    simply drift until edited from a side with access.

    Returns ``(status, counterpart_tree)``: ``("synced", tree)`` when the
    counterpart was updated, ``("skipped_no_access", None)`` when identity
    fields changed but the actor may not write the other tree (the one case
    the editor should be told about), and ``(None, None)`` when there was
    nothing to sync (no link, no identity change, feature off, counterpart
    gone).
    """
    if member.linked_member_id is None:
        return None, None
    synced = {k: v for k, v in changes.items() if k in BRIDGE_SYNC_FIELDS}
    if not synced:
        return None, None
    from app.services import feature_service  # noqa: PLC0415

    if not feature_service.is_enabled(db, "tree_links", user):
        return None, None
    counterpart = db.get(Member, member.linked_member_id)
    if counterpart is None:
        return None, None
    target_tree = db.get(Tree, counterpart.tree_id)
    if target_tree is None:
        return None, None
    if not user.is_admin and role_for(db, target_tree, user) not in (
        "owner",
        "editor",
    ):
        return "skipped_no_access", None
    for key, value in synced.items():
        if key == "image_data" and value:
            # Media files are tree-scoped: copy the file into the
            # counterpart's tree instead of sharing the URL across trees.
            value = copy_media_to_tree(value, counterpart.tree_id)
        setattr(counterpart, key, value)
    return "synced", target_tree


# --- Members ---------------------------------------------------------------
@router.get("/members", response_model=list[MemberOut])
def list_members(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree_public),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
    surface: bool = Query(False),
):
    if _public_only(db, tree, user):
        stmt = (
            select(*_PUBLIC_MEMBER_COLUMNS)
            .where(Member.tree_id == tree.id)
            .order_by(Member.id)
        )
        rows = db.execute(apply_pagination(stmt, pagination)).all()
        return JSONResponse(content=_public_member_payloads(rows))
    if surface:
        stmt = (
            select(*_MEMBER_SURFACE_COLUMNS)
            .where(Member.tree_id == tree.id)
            .order_by(Member.id)
        )
        return [
            MemberSurfaceOut(**row._mapping)
            for row in db.execute(apply_pagination(stmt, pagination)).all()
        ]
    statement = select(Member).where(Member.tree_id == tree.id).order_by(Member.id)
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("/members", response_model=MemberOut, status_code=201)
def create_member(
    payload: MemberCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    if data.get("linked_tree_id") is not None or (
        data.get("linked_member_id") is not None
    ):
        # A brand-new member can't already have a bridge counterpart — that
        # requires writing a row in another tree, which only the dedicated
        # link endpoint does. See POST /members/{id}/link.
        raise HTTPException(
            status_code=400,
            detail="Establish tree links via the link endpoint",
        )
    new_image_url: str | None = None
    try:
        new_image_url_candidate = process_image_field(
            tree.id,
            data.get("image_data"),
            get_media_limits(db),
        )
        data["image_data"] = new_image_url_candidate
        prefix = MEDIA_URL_PREFIX
        if new_image_url_candidate and new_image_url_candidate.startswith(prefix):
            new_image_url = new_image_url_candidate
    except ImageTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (UnsupportedImageType, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Check media quota (write-then-verify: the file is already on disk, so
    # compute_usage() counts it; pass 0 to avoid double-counting it).
    if new_image_url:
        try:
            check_media_quota(db, tree, 0)
        except QuotaExceeded as exc:
            delete_media(new_image_url)
            raise HTTPException(status_code=413, detail=str(exc)) from exc

    # Check tree-data quota (pre-write estimate).
    try:
        check_tree_quota(db, tree, len(str(data).encode()))
    except QuotaExceeded as exc:
        if new_image_url:
            delete_media(new_image_url)
        raise HTTPException(status_code=413, detail=str(exc)) from exc

    member = Member(tree_id=tree.id, **data)
    db.add(member)
    label = (
        " ".join(filter(None, [data.get("first_name"), data.get("last_name")])) or None
    )
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="create",
        target_type="member",
        target_id=member.id,
        target_label=label,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(member)
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    invalidate_stats(tree.id)
    return member


@router.patch("/members/positions", status_code=204)
def update_member_positions(
    payload: list[MemberPositionUpdate],
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Persist many member positions in one round-trip (re-layout / drag).

    Declared before ``/members/{member_id}`` so the literal ``positions`` path
    isn't captured as a member id. Unknown ids are silently skipped.
    """
    if not payload:
        return
    ids = [p.id for p in payload]
    members = {
        m.id: m
        for m in db.scalars(
            select(Member).where(Member.tree_id == tree.id, Member.id.in_(ids))
        )
    }
    for p in payload:
        member = members.get(p.id)
        if member is not None:
            member.position_x = p.position_x
            member.position_y = p.position_y
    db.commit()
    publish_tree_event(db, tree, "tree.layout_changed", {"tree_id": tree.id})


@router.patch("/members/collapsed", status_code=204)
def update_member_collapsed(
    payload: list[MemberCollapsedUpdate],
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Persist collapse/expand state for many members in one round-trip.

    Declared before ``/members/{member_id}`` so the literal ``collapsed`` path
    isn't captured as a member id. Unknown ids are silently skipped.
    """
    if not payload:
        return
    ids = [p.id for p in payload]
    members = {
        m.id: m
        for m in db.scalars(
            select(Member).where(Member.tree_id == tree.id, Member.id.in_(ids))
        )
    }
    for p in payload:
        member = members.get(p.id)
        if member is not None:
            member.is_collapsed = p.is_collapsed
    db.commit()


@router.get("/members/search", response_model=list[MemberSurfaceOut])
def search_members(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=50),
    tree: Tree = Depends(get_readable_tree_public),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Full-text name search scoped to the tree.  Declared before
    ``/members/{member_id}`` so the literal ``search`` path is not captured
    as a member id."""
    pattern = f"%{q}%"
    public_only = _public_only(db, tree, user)
    columns = _PUBLIC_MEMBER_COLUMNS if public_only else _MEMBER_SURFACE_COLUMNS
    stmt = (
        select(*columns)
        .where(
            Member.tree_id == tree.id,
            or_(
                Member.first_name.ilike(pattern),
                Member.last_name.ilike(pattern),
                Member.maiden_name.ilike(pattern),
            ),
        )
        .order_by(Member.last_name, Member.first_name)
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    if public_only:
        return JSONResponse(content=_public_member_payloads(rows))
    return [MemberSurfaceOut(**row._mapping) for row in rows]


@router.get("/members/neighborhood", response_model=NeighborhoodOut)
def get_neighborhood(
    root: str | None = Query(None),
    up: int = Query(3, ge=0, le=20),
    down: int = Query(3, ge=0, le=20),
    partners: bool = Query(True),
    tree: Tree = Depends(get_readable_tree_public),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Return a bounded BFS neighborhood around *root*.  Declared before
    ``/members/{member_id}`` so the literal ``neighborhood`` path is not
    captured as a member id.

    When *root* is omitted the most-connected member is chosen automatically.
    """
    total_count: int = (
        db.scalar(select(func.count(Member.id)).where(Member.tree_id == tree.id)) or 0
    )

    if total_count == 0:
        return NeighborhoodOut(
            members=[], relations=[], root_id="", truncated=False, total_member_count=0
        )

    root_id = root
    if root_id is None:
        root_id = pick_default_root(db, tree.id)
    if root_id is None:
        return NeighborhoodOut(
            members=[], relations=[], root_id="", truncated=False, total_member_count=0
        )

    if (
        db.scalar(
            select(Member.id).where(Member.id == root_id, Member.tree_id == tree.id)
        )
        is None
    ):
        raise HTTPException(status_code=404, detail="Root member not found")

    member_ids, truncated = collect_neighborhood_ids(
        db, tree.id, root_id, up, down, partners
    )

    public_only = _public_only(db, tree, user)
    columns = _PUBLIC_MEMBER_COLUMNS if public_only else _MEMBER_SURFACE_COLUMNS
    surface_stmt = (
        select(*columns)
        .where(Member.tree_id == tree.id, Member.id.in_(member_ids))
        .order_by(Member.id)
    )
    member_rows = db.execute(surface_stmt).all()
    members = (
        _public_member_payloads(member_rows)
        if public_only
        else [MemberSurfaceOut(**row._mapping) for row in member_rows]
    )

    relations = list(
        db.scalars(
            select(Relation).where(
                Relation.tree_id == tree.id,
                Relation.from_member_id.in_(member_ids),
                Relation.to_member_id.in_(member_ids),
            )
        )
    )

    if public_only:
        return JSONResponse(
            content={
                "members": members,
                "relations": [
                    RelationOut.model_validate(relation).model_dump()
                    for relation in relations
                ],
                "root_id": root_id,
                "truncated": truncated,
                "total_member_count": total_count,
            }
        )
    return NeighborhoodOut(
        members=members,
        relations=[RelationOut.model_validate(r) for r in relations],
        root_id=root_id,
        truncated=truncated,
        total_member_count=total_count,
    )


@router.get("/members/{member_id}", response_model=MemberOut)
def get_member(
    member_id: str,
    tree: Tree = Depends(get_readable_tree_public),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    if _public_only(db, tree, user):
        raise HTTPException(status_code=404, detail="Member not found")
    return _get_member(db, tree, member_id)


def _event_updates_allowed(db: Session, tree: Tree, user: User) -> bool:
    """Whether this editor can update the derived vital-event mirror.

    Member dates are core data, while Events is optional and can be hidden for
    an editor.  A disabled/restricted Events domain must therefore never turn a
    member save into a partial failure.
    """
    from app.services import feature_service  # noqa: PLC0415

    if not feature_service.is_enabled(db, "events", user):
        return False
    membership = db.get(TreeMembership, (tree.id, user.id))
    return not (
        membership and membership.restrictions and "events" in membership.restrictions
    )


def _sync_parent_slots(
    db: Session,
    tree: Tree,
    member: Member,
    paternal_changed: bool,
    paternal_parent_id: str | None,
    maternal_changed: bool,
    maternal_parent_id: str | None,
) -> None:
    """Apply explicit parent-slot changes without touching extra parent rows.

    The persisted relation model has no slot column.  We reconstruct the two
    slots with the same gender-first rule as the frontend, then replace only a
    slot the request explicitly changed.  Replaying the same payload is a
    no-op, which keeps retries idempotent.
    """
    relations = list(
        db.scalars(
            select(Relation).where(
                Relation.tree_id == tree.id,
                Relation.from_member_id == member.id,
                Relation.relation_type == "parent",
            )
        ).all()
    )
    parent_ids = [relation.to_member_id for relation in relations]
    parents = {
        parent.id: parent
        for parent in db.scalars(
            select(Member).where(Member.tree_id == tree.id, Member.id.in_(parent_ids))
        ).all()
    }

    paternal_current: str | None = None
    maternal_current: str | None = None
    for parent_id in parent_ids:
        gender = parents.get(parent_id).gender if parent_id in parents else None
        if gender == "m" and paternal_current is None:
            paternal_current = parent_id
        elif gender == "f" and maternal_current is None:
            maternal_current = parent_id
    for parent_id in parent_ids:
        if parent_id in {paternal_current, maternal_current}:
            continue
        if paternal_current is None:
            paternal_current = parent_id
        elif maternal_current is None:
            maternal_current = parent_id

    for changed, previous, replacement in (
        (paternal_changed, paternal_current, paternal_parent_id),
        (maternal_changed, maternal_current, maternal_parent_id),
    ):
        if not changed:
            continue
        if replacement == previous:
            continue
        if previous is not None:
            relation = db.get(Relation, (tree.id, member.id, previous, "parent"))
            if relation is not None:
                db.delete(relation)
        if replacement is None:
            continue
        parent = parents.get(replacement)
        if parent is None:
            parent = db.scalar(
                select(Member).where(
                    Member.id == replacement,
                    Member.tree_id == tree.id,
                )
            )
        if parent is None:
            raise HTTPException(
                status_code=404, detail="parent_id not found in this tree"
            )
        if db.get(Relation, (tree.id, member.id, replacement, "parent")) is None:
            db.add(
                Relation(
                    tree_id=tree.id,
                    from_member_id=member.id,
                    to_member_id=replacement,
                    relation_type="parent",
                )
            )


def _sync_vital_event(
    db: Session,
    tree: Tree,
    member: Member,
    event_type: str,
    date: str | None,
) -> None:
    """Keep one member's birth/death event aligned without losing documents."""
    events = list(
        db.scalars(
            select(Event)
            .join(EventMemberLink, EventMemberLink.event_id == Event.id)
            .where(
                Event.tree_id == tree.id,
                Event.event_type == event_type,
                EventMemberLink.member_id == member.id,
            )
            .order_by(Event.id)
        ).all()
    )
    existing = events[0] if events else None
    if date:
        if existing is not None:
            # Do not replace the row: its location, description, and linked
            # documents are user-authored details preserved by #659.
            existing.date = date
            return
        event = Event(
            id=str(uuid4()),
            tree_id=tree.id,
            event_type=event_type,
            date=date,
            created_at=utcnow_iso(),
        )
        db.add(event)
        db.flush()
        db.add(EventMemberLink(event_id=event.id, member_id=member.id))
    elif existing is not None:
        db.delete(existing)


@router.patch("/members/{member_id}", response_model=MemberOut)
def update_member(
    member_id: str,
    payload: MemberUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member = _get_member(db, tree, member_id)
    changes = payload.model_dump(exclude_unset=True)
    paternal_changed = "paternal_parent_id" in changes
    maternal_changed = "maternal_parent_id" in changes
    paternal_parent_id = changes.pop("paternal_parent_id", None)
    maternal_parent_id = changes.pop("maternal_parent_id", None)
    # The member form re-sends the link fields unchanged on every save. Only an
    # actual change is a link edit — an unchanged value must not re-run the
    # feature/access checks, otherwise ordinary edits fail once the tree_links
    # flag is turned off (or for editors without access to the linked tree).
    if "linked_tree_id" in changes and changes["linked_tree_id"] == member.linked_tree_id:
        del changes["linked_tree_id"]
    if (
        "linked_member_id" in changes
        and changes["linked_member_id"] == member.linked_member_id
    ):
        del changes["linked_member_id"]
    unlinked_counterpart_tree: Tree | None = None
    if "linked_tree_id" in changes:
        if changes["linked_tree_id"] is not None:
            # Establishing a link requires resolving a bridge person on both
            # sides, which touches two trees — this single-row endpoint can't
            # do that safely. Only clearing (null) or leaving it unchanged is
            # allowed here; see POST /members/{id}/link.
            raise HTTPException(
                status_code=400,
                detail="Establish tree links via the link endpoint",
            )
        _validate_linked_tree(db, tree, user, changes["linked_tree_id"])
        # Unlinking invalidates the counterpart pointer into the old tree.
        changes["linked_member_id"] = None
        # Tear down the other side too: a bridge is symmetric, so unlinking
        # here must also clear the counterpart's fields. Otherwise the link
        # lingers in the other tree (phantom badge) and identity edits keep
        # flowing one-directionally from the still-linked counterpart back to
        # this member. Cleared unconditionally, like the delete path — this is
        # integrity cleanup of a now-broken bridge, not a content edit.
        if member.linked_member_id is not None:
            counterpart = db.get(Member, member.linked_member_id)
            if counterpart is not None:
                counterpart.linked_tree_id = None
                counterpart.linked_member_id = None
                unlinked_counterpart_tree = db.get(Tree, counterpart.tree_id)
    if changes.get("linked_member_id") is not None:
        _validate_linked_member(
            db,
            changes.get("linked_tree_id", member.linked_tree_id),
            changes["linked_member_id"],
            member.id,
        )
    new_image_url: str | None = None
    if "image_data" in changes:
        try:
            new_url = process_image_field(
                tree.id,
                changes["image_data"],
                get_media_limits(db),
            )
            changes["image_data"] = new_url
            if new_url and new_url.startswith(MEDIA_URL_PREFIX):
                new_image_url = new_url
        except ImageTooLarge as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except (UnsupportedImageType, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Check media quota for the new image (write-then-verify: file already on
    # disk and counted by compute_usage, so pass 0 to avoid double-counting).
    if new_image_url:
        try:
            check_media_quota(db, tree, 0)
        except QuotaExceeded as exc:
            delete_media(new_image_url)
            raise HTTPException(status_code=413, detail=str(exc)) from exc
    # Capture before-state for diff details (skip noisy positional/internal fields).
    _SKIP_DIFF = {"position_x", "position_y", "is_collapsed", "image_data"}
    before = {k: getattr(member, k) for k in changes if k not in _SKIP_DIFF}
    for key, value in changes.items():
        setattr(member, key, value)
    if paternal_changed or maternal_changed:
        _sync_parent_slots(
            db,
            tree,
            member,
            paternal_changed,
            paternal_parent_id,
            maternal_changed,
            maternal_parent_id,
        )
    vital_events_changed = _event_updates_allowed(db, tree, user) and (
        "date_of_birth" in changes or "date_of_death" in changes
    )
    if vital_events_changed:
        if "date_of_birth" in changes:
            _sync_vital_event(db, tree, member, "birth", changes["date_of_birth"])
        if "date_of_death" in changes:
            _sync_vital_event(db, tree, member, "death", changes["date_of_death"])
    after = {k: getattr(member, k) for k in before}
    # Bridge person: mirror identity edits onto the counterpart row so the
    # same human stays consistent on both sides of a tree-in-tree link.
    bridge_sync, synced_tree = _sync_bridge_person(db, member, changes, user)
    diff_details: dict | None = None
    changed = {
        k: {"before": before[k], "after": after[k]}
        for k in before
        if before[k] != after[k]
    }
    if changed:
        diff_details = {
            "before": {k: v["before"] for k, v in changed.items()},
            "after": {k: v["after"] for k, v in changed.items()},
        }
    label = " ".join(filter(None, [member.first_name, member.last_name])) or None
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="update",
        target_type="member",
        target_id=member.id,
        target_label=label,
        details=diff_details,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(member)
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    if vital_events_changed:
        publish_tree_event(
            db,
            tree,
            "tree.content_changed",
            {"tree_id": tree.id, "domain": "event"},
        )
    invalidate_stats(tree.id)
    if synced_tree is not None:
        publish_tree_event(
            db,
            synced_tree,
            "tree.content_changed",
            {"tree_id": synced_tree.id, "domain": "member"},
        )
        invalidate_stats(synced_tree.id)
    if unlinked_counterpart_tree is not None:
        publish_tree_event(
            db,
            unlinked_counterpart_tree,
            "tree.content_changed",
            {"tree_id": unlinked_counterpart_tree.id, "domain": "member"},
        )
        invalidate_stats(unlinked_counterpart_tree.id)
    out = MemberOut.model_validate(member)
    out.bridge_sync = bridge_sync
    return out


@router.post(
    "/members/{member_id}/subtree",
    response_model=MemberSubtreeOut,
    status_code=201,
)
def create_member_subtree(
    member_id: str,
    payload: MemberSubtreeCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new tree seeded with a copy of this member and link both ways.

    The member becomes the "bridge person": a clone of their identity fields
    (including a copied photo) is created as the sole member of the new tree,
    and the two rows point at each other via linked_tree_id/linked_member_id,
    so navigation works in both directions and lands on the counterpart.
    """
    from app.services import feature_service  # noqa: PLC0415

    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    member = _get_member(db, tree, member_id)
    if member.linked_tree_id is not None:
        raise HTTPException(status_code=409, detail="Member is already linked to a tree")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="A name is required")

    new_tree = create_linked_subtree(
        db, source_tree=tree, member=member, owner=user, name=name
    )
    return MemberSubtreeOut(
        tree=TreeOut.model_validate(new_tree),
        anchor=MemberOut.model_validate(member),
    )


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
    from app.services import feature_service  # noqa: PLC0415
    from app.services.merge import (  # noqa: PLC0415
        compute_conflicts,
        member_key,
        member_name_key,
    )

    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    member = _get_member(db, tree, member_id)

    _validate_linked_tree(db, tree, user, target_tree_id)
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
    from app.services import feature_service  # noqa: PLC0415
    from app.services.merge import _clone_member, _wire_bridge  # noqa: PLC0415

    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    member = _get_member(db, tree, member_id)
    if member.linked_tree_id is not None:
        raise HTTPException(status_code=409, detail="Member is already linked to a tree")

    _validate_linked_tree(db, tree, user, payload.linked_tree_id)
    target = db.get(Tree, payload.linked_tree_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Linked tree not found")
    # Establishing a bridge writes the counterpart row too, so read access to
    # the target (already checked by _validate_linked_tree) is not enough.
    if not user.is_admin and role_for(db, target, user) not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="No write access to the linked tree")

    if payload.mode == "create":
        counterpart = _clone_member(member, target.id, str(uuid4()))
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

    _wire_bridge(member, counterpart)
    if payload.mode == "existing":
        # The two rows may describe the same person with differing details
        # (dates, places, notes, ...) — reconcile them onto both sides now
        # rather than letting the bridge start out of sync. field_choices is
        # ignored for mode="create": the counterpart there is a fresh clone of
        # `member`, so there is nothing to reconcile.
        from app.services.merge import reconcile_bridge_fields  # noqa: PLC0415

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
    from app.services import feature_service  # noqa: PLC0415

    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    member = _get_member(db, tree, member_id)
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


@router.delete("/members/{member_id}", status_code=204)
def delete_member(
    member_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member = _get_member(db, tree, member_id)
    # Deleting one half of a bridge person dissolves the tree-in-tree link: the
    # surviving counterpart becomes an ordinary member again. The FK only SET
    # NULLs its linked_member_id (the pointer at this row), leaving a dangling
    # linked_tree_id / broken badge — so clear both sides explicitly here.
    counterpart_tree: Tree | None = None
    if member.linked_member_id is not None:
        counterpart = db.get(Member, member.linked_member_id)
        if counterpart is not None:
            counterpart.linked_tree_id = None
            counterpart.linked_member_id = None
            counterpart_tree = db.get(Tree, counterpart.tree_id)
    label = " ".join(filter(None, [member.first_name, member.last_name])) or None
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="delete",
        target_type="member",
        target_id=member.id,
        target_label=label,
    )
    db.delete(member)
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    invalidate_stats(tree.id)
    if counterpart_tree is not None:
        publish_tree_event(
            db,
            counterpart_tree,
            "tree.content_changed",
            {"tree_id": counterpart_tree.id, "domain": "member"},
        )
        invalidate_stats(counterpart_tree.id)


# --- Relations -------------------------------------------------------------
@router.get("/relations", response_model=list[RelationOut])
def list_relations(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree_public),
    db: Session = Depends(get_db),
):
    statement = (
        select(Relation)
        .where(Relation.tree_id == tree.id)
        .order_by(
            Relation.from_member_id,
            Relation.to_member_id,
            Relation.relation_type,
        )
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("/relations", response_model=RelationOut, status_code=201)
def add_relation(
    payload: RelationCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from_member = db.scalar(
        select(Member).where(
            Member.id == payload.from_member_id, Member.tree_id == tree.id
        )
    )
    if from_member is None:
        raise HTTPException(
            status_code=404, detail="from_member_id not found in this tree"
        )
    to_member = db.scalar(
        select(Member).where(Member.id == payload.to_member_id, Member.tree_id == tree.id)
    )
    if to_member is None:
        raise HTTPException(status_code=404, detail="to_member_id not found in this tree")
    if db.get(RelationType, payload.relation_type) is None:
        raise HTTPException(status_code=404, detail="Unknown relation_type")

    key = (tree.id, payload.from_member_id, payload.to_member_id, payload.relation_type)
    relation = db.get(Relation, key)
    if relation is None:
        try:
            check_tree_quota(db, tree, len(str(payload.model_dump()).encode()))
        except QuotaExceeded as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        relation = Relation(tree_id=tree.id, **payload.model_dump())
        db.add(relation)
        label = (
            f"{payload.from_member_id} → {payload.to_member_id} ({payload.relation_type})"
        )
        record_activity(
            db,
            tree_id=tree.id,
            actor=user,
            action="create",
            target_type="relation",
            target_label=label,
        )
        db.commit()
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
        publish_tree_event(
            db,
            tree,
            "tree.content_changed",
            {"tree_id": tree.id, "domain": "member"},
        )
        invalidate_stats(tree.id)
    return relation


@router.delete("/relations", status_code=204)
def remove_relation(
    from_member_id: str,
    to_member_id: str,
    relation_type: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    relation = db.get(Relation, (tree.id, from_member_id, to_member_id, relation_type))
    if relation is not None:
        label = f"{from_member_id} → {to_member_id} ({relation_type})"
        record_activity(
            db,
            tree_id=tree.id,
            actor=user,
            action="delete",
            target_type="relation",
            target_label=label,
        )
        db.delete(relation)
        db.commit()
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
        publish_tree_event(
            db,
            tree,
            "tree.content_changed",
            {"tree_id": tree.id, "domain": "member"},
        )
        invalidate_stats(tree.id)


# --- Diseases --------------------------------------------------------------
@router.get(
    "/diseases",
    response_model=list[DiseaseOut],
    dependencies=[Depends(require_domain("diseases"))],
)
def list_diseases(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    statement = (
        select(MemberDisease)
        .where(MemberDisease.tree_id == tree.id)
        .order_by(MemberDisease.id)
    )
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post(
    "/diseases",
    response_model=DiseaseOut,
    status_code=201,
    dependencies=[Depends(require_domain("diseases"))],
)
def add_disease(
    payload: DiseaseCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_member(db, tree, payload.member_id)
    try:
        check_tree_quota(db, tree, len(str(payload.model_dump()).encode()))
    except QuotaExceeded as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    disease = MemberDisease(tree_id=tree.id, **payload.model_dump())
    db.add(disease)
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="create",
        target_type="disease",
        target_label=payload.name,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(disease)
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    invalidate_stats(tree.id)
    return disease


@router.patch(
    "/diseases/{disease_id}",
    response_model=DiseaseOut,
    dependencies=[Depends(require_domain("diseases"))],
)
def update_disease(
    disease_id: str,
    payload: DiseaseUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    disease = db.get(MemberDisease, disease_id)
    if disease is None or disease.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Disease not found")
    for key, value in payload.model_dump().items():
        setattr(disease, key, value)
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="update",
        target_type="disease",
        target_id=disease_id,
        target_label=disease.name,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(disease)
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    invalidate_stats(tree.id)
    return disease


@router.delete(
    "/diseases/{disease_id}",
    status_code=204,
    dependencies=[Depends(require_domain("diseases"))],
)
def delete_disease(
    disease_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    disease = db.get(MemberDisease, disease_id)
    if disease is None or disease.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Disease not found")
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="delete",
        target_type="disease",
        target_id=disease_id,
        target_label=disease.name,
    )
    db.delete(disease)
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    invalidate_stats(tree.id)
