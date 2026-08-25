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
    get_readable_workspace_public,
    get_workspace_access,
    get_workspace_access_write,
    get_writable_workspace,
)
from app.api.pagination import Pagination, apply_pagination, pagination_params
from app.core.exceptions import QuotaExceeded
from app.db.session import get_db
from app.models import Event, EventMemberLink, Member, Workspace
from app.models.user import User
from app.schemas.family import (
    MemberCollapsedUpdate,
    MemberCreate,
    MemberOut,
    MemberPositionUpdate,
    MemberSurfaceOut,
    MemberUpdate,
    NeighborhoodContinuation,
    NeighborhoodOut,
    RelationOut,
)
from app.schemas.merge import MemberMergePreviewOut, MemberMergeRequest
from app.services.activity.activity import member_delete_snapshot, record_activity
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_workspace_event
from app.services.media.storage import (
    MEDIA_URL_PREFIX,
    ImageTooLarge,
    UnsupportedImageType,
    delete_media,
    process_image_field,
)
from app.services.media.storage_usage import check_media_quota, check_workspace_quota
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
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.neighborhood import (
    MAX_NEIGHBORHOOD_NODES,
    MAX_NEIGHBORHOOD_TOTAL,
    NeighborhoodQuery,
    collect_neighborhood_page,
    continuation_counts,
    graph_revision,
    pick_default_root,
    relations_for_page,
    resolve_section_ids,
)
from app.services.workspaces.neighborhood_cursor import (
    decode_cursor,
    encode_cursor,
    visibility_fingerprint,
)
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["members"])


# --- Members ---------------------------------------------------------------
@router.get("/members", response_model=list[MemberOut])
def list_members(
    pagination: Pagination = Depends(pagination_params),
    tree: Workspace = Depends(get_readable_workspace_public),
    user: User | None = Depends(get_current_user_optional),
    context: WorkspaceAccessContext = Depends(get_workspace_access),
    db: Session = Depends(get_db),
    surface: bool = Query(False),
):
    filters = [Member.workspace_id == tree.id]
    member_filter = context.member_filter()
    if member_filter is not None:
        filters.append(member_filter)
    if public_only(db, tree, user):
        stmt = select(*PUBLIC_MEMBER_COLUMNS).where(*filters).order_by(Member.id)
        rows = db.execute(apply_pagination(stmt, pagination)).all()
        return JSONResponse(content=public_member_payloads(rows))
    if surface:
        stmt = select(*MEMBER_SURFACE_COLUMNS).where(*filters).order_by(Member.id)
        return [
            MemberSurfaceOut(**row._mapping)
            for row in db.execute(apply_pagination(stmt, pagination)).all()
        ]
    statement = select(Member).where(*filters).order_by(Member.id)
    return db.scalars(apply_pagination(statement, pagination)).all()


@router.post("/members", response_model=MemberOut, status_code=201)
def create_member(
    payload: MemberCreate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    if data.get("linked_workspace_id") is not None or (
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
        check_workspace_quota(db, tree, len(str(data).encode()))
    except QuotaExceeded:
        if new_image_url:
            delete_media(new_image_url)
        raise

    with UnitOfWork(db) as uow:
        member = Member(workspace_id=tree.id, **data)
        db.add(member)
        label = (
            " ".join(filter(None, [data.get("first_name"), data.get("last_name")]))
            or None
        )
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="create",
            target_type="member",
            target_id=member.id,
            target_label=label,
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "member"},
            )
        )
        uow.after_commit(lambda: invalidate_stats(tree.id))
    db.refresh(member)
    return member


@router.patch("/members/positions", status_code=204)
def update_member_positions(
    payload: list[MemberPositionUpdate],
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Persist many member positions in one round-trip (re-layout / drag).

    Declared before ``/members/{member_id}`` so the literal ``positions`` path
    isn't captured as a member id. Unknown ids, and ids the caller may not
    edit, are silently skipped.
    """
    if not payload:
        return
    ids = [p.id for p in payload]
    members = {
        m.id: m
        for m in db.scalars(
            select(Member).where(Member.workspace_id == tree.id, Member.id.in_(ids))
        )
        if context.can_write_member(db, m.id, mode="edit")
    }
    with UnitOfWork(db) as uow:
        for p in payload:
            member = members.get(p.id)
            if member is not None:
                member.position_x = p.position_x
                member.position_y = p.position_y
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "workspace.layout_changed", {"workspace_id": tree.id}
            )
        )


@router.patch("/members/collapsed", status_code=204)
def update_member_collapsed(
    payload: list[MemberCollapsedUpdate],
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Persist collapse/expand state for many members in one round-trip.

    Declared before ``/members/{member_id}`` so the literal ``collapsed`` path
    isn't captured as a member id. Unknown ids, and ids the caller may not
    edit, are silently skipped.
    """
    if not payload:
        return
    ids = [p.id for p in payload]
    members = {
        m.id: m
        for m in db.scalars(
            select(Member).where(Member.workspace_id == tree.id, Member.id.in_(ids))
        )
        if context.can_write_member(db, m.id, mode="edit")
    }
    with UnitOfWork(db):
        for p in payload:
            member = members.get(p.id)
            if member is not None:
                member.is_collapsed = p.is_collapsed


def _sync_merged_vital_events(db: Session, tree: Workspace, member: Member) -> None:
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
                    Event.workspace_id == tree.id,
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
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
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
    context.require_write_member(db, payload.keep_id, mode="edit")
    # remove_id's row disappears from every section it was in, so it needs
    # the stricter "editor everywhere it's assigned" delete-level check.
    context.require_write_member(db, payload.remove_id, mode="delete")
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
        sync_vital_event(db, tree, merged, "death", merged.date_of_death, merged.cemetery)

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
        workspace_id=tree.id,
        actor=user,
        action="update",
        target_type="member",
        target_id=merged.id,
        target_label=label,
        details=details,
    )

    # A bridge person's counterpart lives in another tree: its own
    # linked_workspace_id/linked_member_id just changed (re-pointed onto `merged`,
    # or cleared entirely), so that tree gets its own activity entry too —
    # same reasoning as the two record_activity calls in link_member_to_tree.
    counterpart_tree: Workspace | None = None
    if counterpart is not None and bridge_outcome is not None:
        counterpart_tree = db.get(Workspace, counterpart.workspace_id)
        counterpart_label = (
            " ".join(filter(None, [counterpart.first_name, counterpart.last_name]))
            or None
        )
        bridge_details = {
            "after": (
                {
                    "linked_workspace_id": merged.workspace_id,
                    "linked_member_id": merged.id,
                }
                if bridge_outcome == "inherited"
                else {"linked_workspace_id": None, "linked_member_id": None}
            )
        }
        record_activity(
            db,
            workspace_id=counterpart_tree.id,
            actor=user,
            action="update",
            target_type="member",
            target_id=counterpart.id,
            target_label=counterpart_label,
            details=bridge_details,
        )

    with UnitOfWork(db) as uow:
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        # A merge can touch any content that was linked to `remove`, not just
        # the member row itself, so every domain the transfer covers gets
        # notified — see MemberMergeTransferCounts (#812).
        for domain in ("member", "event", "story", "gallery", "document", "task"):
            uow.after_commit(
                lambda domain=domain: publish_workspace_event(
                    db,
                    tree,
                    "workspace.content_changed",
                    {"workspace_id": tree.id, "domain": domain},
                )
            )
        uow.after_commit(lambda: invalidate_stats(tree.id))

        notified_tree_ids: set[str] = set()
        if counterpart_tree is not None:
            uow.after_commit(
                lambda: publish_workspace_event(
                    db,
                    counterpart_tree,
                    "activity.entry_added",
                    {"workspace_id": counterpart_tree.id},
                )
            )
            uow.after_commit(
                lambda: publish_workspace_event(
                    db,
                    counterpart_tree,
                    "workspace.content_changed",
                    {"workspace_id": counterpart_tree.id, "domain": "member"},
                )
            )
            uow.after_commit(lambda: invalidate_stats(counterpart_tree.id))
            notified_tree_ids.add(counterpart_tree.id)
        if (
            bridge_synced_tree is not None
            and bridge_synced_tree.id not in notified_tree_ids
        ):
            uow.after_commit(
                lambda: publish_workspace_event(
                    db,
                    bridge_synced_tree,
                    "workspace.content_changed",
                    {"workspace_id": bridge_synced_tree.id, "domain": "member"},
                )
            )
            uow.after_commit(lambda: invalidate_stats(bridge_synced_tree.id))
    db.refresh(merged)
    return merged


@router.get("/members/search", response_model=list[MemberSurfaceOut])
def search_members(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=50),
    tree: Workspace = Depends(get_readable_workspace_public),
    user: User | None = Depends(get_current_user_optional),
    context: WorkspaceAccessContext = Depends(get_workspace_access),
    db: Session = Depends(get_db),
):
    """Full-text name search scoped to the tree.  Declared before
    ``/members/{member_id}`` so the literal ``search`` path is not captured
    as a member id."""
    public = public_only(db, tree, user)
    columns = PUBLIC_MEMBER_COLUMNS if public else MEMBER_SURFACE_COLUMNS
    filters = [Member.workspace_id == tree.id, member_name_search_clause(q)]
    member_filter = context.member_filter()
    if member_filter is not None:
        filters.append(member_filter)
    stmt = (
        select(*columns)
        .where(*filters)
        .order_by(Member.last_name, Member.first_name)
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    if public:
        return JSONResponse(content=public_member_payloads(rows))
    return [MemberSurfaceOut(**row._mapping) for row in rows]


def _empty_neighborhood(total_count: int) -> NeighborhoodOut:
    return NeighborhoodOut(
        members=[],
        relations=[],
        root_id="",
        truncated=False,
        total_member_count=total_count,
    )


@router.get("/members/neighborhood", response_model=NeighborhoodOut)
def get_neighborhood(
    root: str | None = Query(None),
    up: int = Query(3, ge=0, le=20),
    down: int = Query(3, ge=0, le=20),
    partners: bool = Query(True),
    sections: list[str] | None = Query(None),
    budget: int = Query(MAX_NEIGHBORHOOD_NODES, ge=1, le=MAX_NEIGHBORHOOD_NODES),
    cursor: str | None = Query(None),
    tree: Workspace = Depends(get_readable_workspace_public),
    user: User | None = Depends(get_current_user_optional),
    context: WorkspaceAccessContext = Depends(get_workspace_access),
    db: Session = Depends(get_db),
):
    """Return one bounded page of the neighborhood around *root*.  Declared
    before ``/members/{member_id}`` so the literal ``neighborhood`` path is not
    captured as a member id.

    When *root* is omitted the most-connected member in scope is chosen
    automatically. ``sections`` restricts the traversal to those sections;
    ``budget`` caps this page; ``cursor`` — replayed with the *same* request
    parameters — continues where the previous page stopped. A cursor whose
    graph or focus root has moved on returns 409 ``stale_cursor`` (restart the
    traversal); one that does not belong to this request returns 400.

    Every member this endpoint can return — root, page, continuation counts —
    is bounded by ``context``'s resolved visibility boundary (#984), not just
    by ``sections``: that query param is a view filter the caller chooses,
    never an access grant.
    """
    visible_section_ids = context.visible_section_ids()
    count_filters = [Member.workspace_id == tree.id]
    member_filter = context.member_filter()
    if member_filter is not None:
        count_filters.append(member_filter)
    total_count: int = (
        db.scalar(select(func.count(Member.id)).where(*count_filters)) or 0
    )
    if total_count == 0:
        return _empty_neighborhood(0)

    section_ids = resolve_section_ids(
        db, tree.id, sections, visible_section_ids=visible_section_ids
    )
    root_id = (
        root
        if root is not None
        else pick_default_root(
            db, tree.id, section_ids, visible_section_ids=visible_section_ids
        )
    )
    if root_id is None:
        # Reachable on a populated workspace: a section filter can resolve to
        # nothing, or name only sections/members the caller cannot read.
        return _empty_neighborhood(total_count)

    if (
        db.scalar(
            select(Member.id).where(Member.id == root_id, Member.workspace_id == tree.id)
        )
        is None
        or not context.can_read_member(db, root_id)
    ):
        raise HTTPException(status_code=404, detail="Root member not found")

    query = NeighborhoodQuery(
        root_id=root_id,
        up=up,
        down=down,
        include_partners=partners,
        section_ids=section_ids,
        budget=budget,
        visible_section_ids=visible_section_ids,
    )
    visibility = visibility_fingerprint(context)
    revision = graph_revision(db, tree.id)
    offset = (
        decode_cursor(cursor, tree.id, query, visibility=visibility, revision=revision)
        if cursor
        else 0
    )

    page = collect_neighborhood_page(db, tree.id, query, offset)

    public = public_only(db, tree, user)
    columns = PUBLIC_MEMBER_COLUMNS if public else MEMBER_SURFACE_COLUMNS
    member_rows = db.execute(
        select(*columns)
        .where(Member.workspace_id == tree.id, Member.id.in_(page.member_ids))
        .order_by(Member.id)
    ).all()
    members = (
        public_member_payloads(member_rows)
        if public
        else [MemberSurfaceOut(**row._mapping) for row in member_rows]
    )
    relations = relations_for_page(db, tree.id, page.member_ids, page.delivered_ids)

    next_offset = offset + len(page.member_ids)
    next_cursor = (
        encode_cursor(
            tree.id,
            query,
            visibility=visibility,
            revision=revision,
            offset=next_offset,
        )
        if page.has_more and next_offset < MAX_NEIGHBORHOOD_TOTAL
        else None
    )
    # Only what this page actually left behind: a scope the traversal cannot
    # reach anyway (a disconnected member, a section member off the focus
    # branch) must not show up as a "load more" the cursor can never satisfy.
    # Section names and counts also stay out of public responses — reading
    # sections needs an authenticated grant (see the sections router).
    continuations = (
        [
            NeighborhoodContinuation(
                section_id=section_id,
                section_name=section_name,
                remaining_count=remaining,
            )
            for section_id, section_name, remaining in continuation_counts(
                db, tree.id, section_ids, page.delivered_ids, total_count
            )
        ]
        if page.has_more and not (public and section_ids is not None)
        else []
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
                "truncated": page.has_more,
                "total_member_count": total_count,
                "next_cursor": next_cursor,
                "continuations": [c.model_dump() for c in continuations],
            }
        )
    return NeighborhoodOut(
        members=members,
        relations=[RelationOut.model_validate(r) for r in relations],
        root_id=root_id,
        truncated=page.has_more,
        total_member_count=total_count,
        next_cursor=next_cursor,
        continuations=continuations,
    )


@router.get("/members/{member_id}", response_model=MemberOut)
def get_member(
    member_id: str,
    tree: Workspace = Depends(get_readable_workspace_public),
    user: User | None = Depends(get_current_user_optional),
    context: WorkspaceAccessContext = Depends(get_workspace_access),
    db: Session = Depends(get_db),
):
    if public_only(db, tree, user):
        raise HTTPException(status_code=404, detail="Member not found")
    context.require_read_member(db, member_id)
    return get_member_row(db, tree, member_id)


@router.get(
    "/members/{member_id}/merge-preview",
    response_model=MemberMergePreviewOut,
)
def get_member_merge_preview(
    member_id: str,
    other: str = Query(...),
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Field conflicts + transfer counts for a same-tree member merge (#729).

    ``member_id`` previews as the surviving ("keep") side and ``other`` as
    the one that would be removed; the merge itself is symmetric in what it
    computes here, only ``POST /members/merge`` cares which id is which.
    """
    context.require_read_member(db, member_id)
    context.require_read_member(db, other)
    keep = get_member_row(db, tree, member_id)
    remove = get_member_row(db, tree, other)
    if keep.id == remove.id:
        raise HTTPException(status_code=400, detail="Cannot merge a member with itself")
    return compute_member_merge_preview(db, tree, keep, remove)


@router.patch("/members/{member_id}", response_model=MemberOut)
def update_member(
    member_id: str,
    payload: MemberUpdate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    context.require_write_member(db, member_id, mode="edit")
    result = update_member_service(
        db, tree=tree, user=user, member_id=member_id, payload=payload
    )
    out = MemberOut.model_validate(result.member)
    out.bridge_sync = result.bridge_sync
    return out


@router.delete("/members/{member_id}", status_code=204)
def delete_member(
    member_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    context.require_write_member(db, member_id, mode="delete")
    member = get_member_row(db, tree, member_id)
    # Deleting one half of a bridge person dissolves the tree-in-tree link: the
    # surviving counterpart becomes an ordinary member again. The FK only SET
    # NULLs its linked_member_id (the pointer at this row), leaving a dangling
    # linked_workspace_id / broken badge — so clear both sides explicitly here.
    counterpart: Member | None = None
    counterpart_tree: Workspace | None = None
    if member.linked_member_id is not None:
        counterpart = db.get(Member, member.linked_member_id)
        if counterpart is not None:
            counterpart.linked_workspace_id = None
            counterpart.linked_member_id = None
            counterpart_tree = db.get(Workspace, counterpart.workspace_id)
    label = " ".join(filter(None, [member.first_name, member.last_name])) or None
    record_activity(
        db,
        workspace_id=tree.id,
        actor=user,
        action="delete",
        target_type="member",
        target_id=member.id,
        target_label=label,
        details=member_delete_snapshot(db, member, counterpart),
    )
    db.delete(member)
    with UnitOfWork(db) as uow:
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "member"},
            )
        )
        uow.after_commit(lambda: invalidate_stats(tree.id))
        if counterpart_tree is not None:
            uow.after_commit(
                lambda: publish_workspace_event(
                    db,
                    counterpart_tree,
                    "workspace.content_changed",
                    {"workspace_id": counterpart_tree.id, "domain": "member"},
                )
            )
            uow.after_commit(lambda: invalidate_stats(counterpart_tree.id))
