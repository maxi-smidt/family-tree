"""Core member CRUD, search and merge — scoped to a tree.

Relations, diseases, subtree creation and cross-tree linking live in their
own sibling modules (``member_relations``, ``member_diseases``,
``member_subtrees``, ``member_links``); this module keeps the member row
itself plus the read surfaces (list/search/neighborhood) and merge.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_current_user_optional,
    get_readable_tree_public,
    get_writable_tree,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.core.exceptions import QuotaExceeded
from app.db.session import get_db
from app.models import Event, EventMemberLink, Member, Relation, Tree
from app.models.user import User
from app.schemas.family import (
    MemberCollapsedUpdate,
    MemberCreate,
    MemberOut,
    MemberPositionUpdate,
    MemberSurfaceOut,
    MemberUpdate,
    NeighborhoodOut,
    RelationOut,
)
from app.schemas.merge import MemberMergePreviewOut, MemberMergeRequest
from app.services.activity.activity import member_delete_snapshot, record_activity
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_tree_event
from app.services.media.storage import (
    MEDIA_URL_PREFIX,
    ImageTooLarge,
    UnsupportedImageType,
    delete_media,
    process_image_field,
)
from app.services.media.storage_usage import check_media_quota, check_tree_quota
from app.services.members.bridge import sync_bridge_person
from app.services.members.member_access import (
    PUBLIC_MEMBER_COLUMNS,
    public_member_payloads,
    public_only,
)
from app.services.members.member_access import (
    get_member as get_member_row,
)
from app.services.members.member_merge import (
    compute_member_merge_preview,
    merge_members_in_place,
)
from app.services.members.member_search import (
    MEMBER_SURFACE_COLUMNS,
    member_name_search_clause,
)
from app.services.members.member_update import update_member as update_member_service
from app.services.members.member_vitals import event_updates_allowed, sync_vital_event
from app.services.system.settings_service import get_media_limits
from app.services.trees.neighborhood import collect_neighborhood_ids, pick_default_root

router = APIRouter(prefix="/trees/{tree_id}", tags=["members"])


# --- Members ---------------------------------------------------------------
@router.get("/members", response_model=list[MemberOut])
def list_members(
    pagination: Pagination = Depends(pagination_params),
    tree: Tree = Depends(get_readable_tree_public),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
    surface: bool = Query(False),
):
    if public_only(db, tree, user):
        stmt = (
            select(*PUBLIC_MEMBER_COLUMNS)
            .where(Member.tree_id == tree.id)
            .order_by(Member.id)
        )
        rows = db.execute(apply_pagination(stmt, pagination)).all()
        return JSONResponse(content=public_member_payloads(rows))
    if surface:
        stmt = (
            select(*MEMBER_SURFACE_COLUMNS)
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
        except QuotaExceeded:
            delete_media(new_image_url)
            raise

    # Check tree-data quota (pre-write estimate).
    try:
        check_tree_quota(db, tree, len(str(data).encode()))
    except QuotaExceeded:
        if new_image_url:
            delete_media(new_image_url)
        raise

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


def _sync_merged_vital_events(db: Session, tree: Tree, member: Member) -> None:
    """After a merge re-points event links onto ``member``, drop duplicate
    birth/death mirror events.

    ``merge_members_in_place`` unions every event link from ``remove`` onto
    ``keep`` without knowing which are derived vital-event mirrors, so a
    duplicate birth/death event survives whenever both members had one —
    ``sync_vital_event`` assumes exactly one per type (#812).
    """
    for event_type in ("birth", "death"):
        mirrors = list(
            db.scalars(
                select(Event)
                .join(EventMemberLink, EventMemberLink.event_id == Event.id)
                .where(
                    Event.tree_id == tree.id,
                    Event.event_type == event_type,
                    EventMemberLink.member_id == member.id,
                )
                .order_by(Event.id)
            )
        )
        for duplicate in mirrors[1:]:
            db.delete(duplicate)
    db.flush()


@router.post("/members/merge", response_model=MemberOut)
def merge_members(
    payload: MemberMergeRequest,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Merge two members of this tree in place (#729).

    ``keep_id`` survives; ``remove_id`` is deleted after its relations,
    content links, and diseases are re-pointed onto ``keep_id`` and its
    conflicting fields are resolved per ``fields`` (a/b/combine, same
    semantics as the tree-merge resolver). Declared above
    ``/members/{member_id}`` — like ``positions``/``collapsed`` — so the
    literal ``merge`` path segment isn't captured as a member id.
    """
    keep = get_member_row(db, tree, payload.keep_id)
    remove = get_member_row(db, tree, payload.remove_id)
    merged, details, counterpart, bridge_outcome = merge_members_in_place(
        db, tree, keep, remove, payload.fields
    )

    # Vital-event mirror consistency: dedup always runs (integrity cleanup);
    # the date/location resync is skipped when the actor can't touch Events,
    # mirroring update_member's own gating.
    _sync_merged_vital_events(db, tree, merged)
    if event_updates_allowed(db, tree, user):
        sync_vital_event(
            db, tree, merged, "birth", merged.date_of_birth, merged.birthplace
        )
        sync_vital_event(
            db, tree, merged, "death", merged.date_of_death, merged.cemetery
        )

    # Bridge-person drift: mirror field choices that changed keep's identity
    # fields onto its own counterpart, same as update_member does. Uses
    # keep_before (captured pre-merge) rather than remove's raw fields, since
    # a "b" choice can pull remove's value while a "combine" produces a value
    # neither side had.
    keep_before = details["merge"]["keep_before"]
    changed_fields = {
        field: getattr(merged, field)
        for field, before_value in keep_before.items()
        if getattr(merged, field) != before_value
    }
    _, bridge_synced_tree = sync_bridge_person(db, merged, changed_fields, user)

    label = " ".join(filter(None, [merged.first_name, merged.last_name])) or None
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="update",
        target_type="member",
        target_id=merged.id,
        target_label=label,
        details=details,
    )

    # A bridge person's counterpart lives in another tree: its own
    # linked_tree_id/linked_member_id just changed (re-pointed onto `merged`,
    # or cleared entirely), so that tree gets its own activity entry too —
    # same reasoning as the two record_activity calls in link_member_to_tree.
    counterpart_tree: Tree | None = None
    if counterpart is not None and bridge_outcome is not None:
        counterpart_tree = db.get(Tree, counterpart.tree_id)
        counterpart_label = (
            " ".join(filter(None, [counterpart.first_name, counterpart.last_name]))
            or None
        )
        bridge_details = {
            "after": (
                {"linked_tree_id": merged.tree_id, "linked_member_id": merged.id}
                if bridge_outcome == "inherited"
                else {"linked_tree_id": None, "linked_member_id": None}
            )
        }
        record_activity(
            db,
            tree_id=counterpart_tree.id,
            actor=user,
            action="update",
            target_type="member",
            target_id=counterpart.id,
            target_label=counterpart_label,
            details=bridge_details,
        )

    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(merged)
    # A merge can touch any content that was linked to `remove`, not just the
    # member row itself, so every domain the transfer covers gets refreshed —
    # see MemberMergeTransferCounts (#812).
    for domain in ("member", "event", "story", "gallery", "document", "task"):
        publish_tree_event(
            db,
            tree,
            "tree.content_changed",
            {"tree_id": tree.id, "domain": domain},
        )
    invalidate_stats(tree.id)

    notified_tree_ids: set[str] = set()
    if counterpart_tree is not None:
        publish_tree_event(
            db, counterpart_tree, "activity.entry_added", {"tree_id": counterpart_tree.id}
        )
        publish_tree_event(
            db,
            counterpart_tree,
            "tree.content_changed",
            {"tree_id": counterpart_tree.id, "domain": "member"},
        )
        invalidate_stats(counterpart_tree.id)
        notified_tree_ids.add(counterpart_tree.id)
    if bridge_synced_tree is not None and bridge_synced_tree.id not in notified_tree_ids:
        publish_tree_event(
            db,
            bridge_synced_tree,
            "tree.content_changed",
            {"tree_id": bridge_synced_tree.id, "domain": "member"},
        )
        invalidate_stats(bridge_synced_tree.id)
    return merged


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
    public = public_only(db, tree, user)
    columns = PUBLIC_MEMBER_COLUMNS if public else MEMBER_SURFACE_COLUMNS
    stmt = (
        select(*columns)
        .where(
            Member.tree_id == tree.id,
            member_name_search_clause(q),
        )
        .order_by(Member.last_name, Member.first_name)
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    if public:
        return JSONResponse(content=public_member_payloads(rows))
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

    public = public_only(db, tree, user)
    columns = PUBLIC_MEMBER_COLUMNS if public else MEMBER_SURFACE_COLUMNS
    surface_stmt = (
        select(*columns)
        .where(Member.tree_id == tree.id, Member.id.in_(member_ids))
        .order_by(Member.id)
    )
    member_rows = db.execute(surface_stmt).all()
    members = (
        public_member_payloads(member_rows)
        if public
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

    if public:
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
    if public_only(db, tree, user):
        raise HTTPException(status_code=404, detail="Member not found")
    return get_member_row(db, tree, member_id)


@router.get(
    "/members/{member_id}/merge-preview",
    response_model=MemberMergePreviewOut,
)
def get_member_merge_preview(
    member_id: str,
    other: str = Query(...),
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Field conflicts + transfer counts for a same-tree member merge (#729).

    ``member_id`` previews as the surviving ("keep") side and ``other`` as
    the one that would be removed; the merge itself is symmetric in what it
    computes here, only ``POST /members/merge`` cares which id is which.
    """
    keep = get_member_row(db, tree, member_id)
    remove = get_member_row(db, tree, other)
    if keep.id == remove.id:
        raise HTTPException(status_code=400, detail="Cannot merge a member with itself")
    return compute_member_merge_preview(db, tree, keep, remove)


@router.patch("/members/{member_id}", response_model=MemberOut)
def update_member(
    member_id: str,
    payload: MemberUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result = update_member_service(
        db, tree=tree, user=user, member_id=member_id, payload=payload
    )
    out = MemberOut.model_validate(result.member)
    out.bridge_sync = result.bridge_sync
    return out


@router.delete("/members/{member_id}", status_code=204)
def delete_member(
    member_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member = get_member_row(db, tree, member_id)
    # Deleting one half of a bridge person dissolves the tree-in-tree link: the
    # surviving counterpart becomes an ordinary member again. The FK only SET
    # NULLs its linked_member_id (the pointer at this row), leaving a dangling
    # linked_tree_id / broken badge — so clear both sides explicitly here.
    counterpart: Member | None = None
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
        details=member_delete_snapshot(db, member, counterpart),
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
