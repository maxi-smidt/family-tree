"""Virtual multi-tree views — read-only composites of 2+ trees."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.activity_query import activity_page, hidden_activity_target_types
from app.api.deps import (
    accessible_tree_ids,
    get_current_user,
    require_feature,
    role_for,
)
from app.api.routes.statistics import compute_statistics
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import (
    Document,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Member,
    MemberDisease,
    Relation,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    Tree,
    User,
)
from app.models.virtual_view import (
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
    VirtualViewSource,
)
from app.schemas.activity import ActivityPageOut
from app.schemas.content import (
    DocumentOut,
    EventLinkOut,
    EventOut,
    GalleryImageOut,
    GalleryLinkOut,
    GeocodeOut,
    GeocodeRequest,
    StoryLinkOut,
    StoryOut,
)
from app.schemas.family import DiseaseOut, MemberOut, RelationOut
from app.schemas.quality import QualityIssue, QualityReport
from app.schemas.statistics import StatisticsReport
from app.schemas.virtual_view import (
    VirtualMemberOut,
    VirtualPositionItem,
    VirtualViewCreate,
    VirtualViewOut,
    VirtualViewSourceOut,
    VirtualViewUpdate,
)
from app.services.admin_audit import record_admin_audit
from app.services.event_bus import event_bus
from app.services.geocoding import resolve_batch, resolve_single
from app.services.quality_checks import run_quality_checks
from app.services.virtual_view_matching import compute_match_groups, persist_matches
from app.services.virtual_view_sources import flatten_tree_ids, view_closure

router = APIRouter(
    prefix="/virtual-views",
    tags=["virtual-views"],
    dependencies=[Depends(require_feature("virtual_views"))],
)

VIRTUAL_VIEW_SOURCE_ACCESS_REVOKED = "virtual_view_source_access_revoked"
VIRTUAL_VIEW_SOURCES_MISSING = "virtual_view_sources_missing"
VIRTUAL_VIEW_SOURCES_NO_OVERLAP = "virtual_view_sources_no_overlap"
VIRTUAL_VIEW_SOURCE_CYCLE = "virtual_view_source_cycle"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _check_source_access(
    db: Session, view: VirtualView, user: User, _seen: set[str] | None = None
) -> None:
    """Raise 403/409 when the user has lost access to a source or too few remain.

    Recurses through nested virtual-view sources: every underlying real tree
    must still be readable and every nested view resolvable and owned by the
    user (admins bypass).
    """
    if _seen is None:
        _seen = set()
    if view.id in _seen:
        return  # defensive: cycles are rejected at write time
    _seen.add(view.id)

    if len(view.sources) < 2:
        raise HTTPException(status_code=409, detail=VIRTUAL_VIEW_SOURCES_MISSING)
    for src in view.sources:
        if src.tree_id is not None:
            tree = db.get(Tree, src.tree_id)
            if tree is None or (
                not user.is_admin and role_for(db, tree, user) is None
            ):
                raise HTTPException(
                    status_code=403, detail=VIRTUAL_VIEW_SOURCE_ACCESS_REVOKED
                )
        else:
            nested = db.get(VirtualView, src.source_view_id)
            if nested is None:
                raise HTTPException(
                    status_code=409, detail=VIRTUAL_VIEW_SOURCES_MISSING
                )
            if nested.owner_id != user.id and not user.is_admin:
                raise HTTPException(
                    status_code=403, detail=VIRTUAL_VIEW_SOURCE_ACCESS_REVOKED
                )
            _check_source_access(db, nested, user, _seen)


def _resolve_view(db: Session, view_id: str, user: User) -> VirtualView:
    view = db.get(VirtualView, view_id)
    if view is None:
        raise HTTPException(status_code=404, detail="Virtual view not found")
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=404, detail="Virtual view not found")
    _check_source_access(db, view, user)
    return view


def _source_out(
    db: Session,
    src: VirtualViewSource,
    user: User,
    accessible_ids: set[str],
) -> VirtualViewSourceOut:
    """Describe one configured source (a real tree or a nested virtual view)."""
    if src.tree_id is not None:
        tree = db.get(Tree, src.tree_id)
        return VirtualViewSourceOut(
            tree_id=src.tree_id,
            tree_name=(tree or Tree(name="")).name,
            accessible=src.tree_id in accessible_ids,
            kind="tree",
            is_virtual=False,
        )
    nested = db.get(VirtualView, src.source_view_id or "")
    accessible = nested is not None and (
        nested.owner_id == user.id or user.is_admin
    )
    return VirtualViewSourceOut(
        tree_id=src.source_view_id or "",
        tree_name=nested.name if nested else "",
        accessible=accessible,
        kind="view",
        is_virtual=True,
    )


def _view_out(
    db: Session, view: VirtualView, user: User, accessible_ids: set[str] | None = None
) -> VirtualViewOut:
    if accessible_ids is None:
        accessible_ids = set(accessible_tree_ids(db, user))
    sources = [
        _source_out(db, src, user, accessible_ids) for src in view.sources
    ]
    return VirtualViewOut(
        id=view.id,
        name=view.name,
        owner_id=view.owner_id,
        created_at=view.created_at,
        last_opened=view.last_opened,
        sources=sources,
    )


def _classify_and_validate_sources(
    db: Session,
    user: User,
    source_ids: list[str],
    target_view_id: str | None,
) -> list[tuple[str, str]]:
    """Validate a proposed source list; return ``[(kind, id), ...]`` in order.

    Accepts real tree ids and ``vv_`` view ids. Enforces the ≥2 distinct sources
    rule, recursive read access to every underlying real tree, and rejects
    cycles (``target_view_id`` may not appear in any source view's closure).
    Raises ``HTTPException`` on any problem.
    """
    unique_ids = list(dict.fromkeys(source_ids))
    if len(unique_ids) < 2:
        raise HTTPException(
            status_code=400, detail="At least 2 distinct source trees required"
        )
    accessible = set(accessible_tree_ids(db, user))
    resolved: list[tuple[str, str]] = []
    for sid in unique_ids:
        if sid.startswith("vv_"):
            nested = db.get(VirtualView, sid)
            if nested is None or (
                nested.owner_id != user.id and not user.is_admin
            ):
                raise HTTPException(
                    status_code=403, detail=f"No access to view {sid}"
                )
            if target_view_id is not None and target_view_id in view_closure(
                db, sid
            ):
                raise HTTPException(
                    status_code=409, detail=VIRTUAL_VIEW_SOURCE_CYCLE
                )
            for tid in flatten_tree_ids(db, nested):
                if tid not in accessible:
                    raise HTTPException(
                        status_code=403, detail=f"No access to tree {tid}"
                    )
            resolved.append(("view", sid))
        else:
            if sid not in accessible:
                raise HTTPException(
                    status_code=403, detail=f"No access to tree {sid}"
                )
            resolved.append(("tree", sid))
    return resolved


def _flatten_resolved(
    db: Session, resolved: list[tuple[str, str]]
) -> list[str]:
    """Ordered, de-duplicated real tree ids for a validated source list."""
    flat: list[str] = []
    for kind, sid in resolved:
        if kind == "tree":
            if sid not in flat:
                flat.append(sid)
        else:
            nested = db.get(VirtualView, sid)
            if nested is None:
                continue
            for tid in flatten_tree_ids(db, nested):
                if tid not in flat:
                    flat.append(tid)
    return flat


def _persist_sources(
    db: Session, view: VirtualView, resolved: list[tuple[str, str]]
) -> None:
    """Replace a view's source rows from a validated ``[(kind, id)]`` list."""
    for i, (kind, sid) in enumerate(resolved):
        if kind == "tree":
            db.add(VirtualViewSource(view_id=view.id, position=i, tree_id=sid))
        else:
            db.add(
                VirtualViewSource(
                    view_id=view.id, position=i, source_view_id=sid
                )
            )


def _ensure_matches(db: Session, view: VirtualView) -> None:
    """Lazily compute matches for legacy views that predate this feature."""
    if view.matches_computed_at is None:
        persist_matches(db, view)
        db.flush()


def _build_id_map(db: Session, view: VirtualView) -> dict[str, str]:
    """Return {original_member_id: node_id} using persisted match groups."""
    _ensure_matches(db, view)
    rows = db.execute(
        select(VirtualViewMemberMatch.member_id, VirtualViewMemberMatch.group_id).where(
            VirtualViewMemberMatch.view_id == view.id
        )
    ).all()
    return {r.member_id: r.group_id for r in rows}


def _load_positions(db: Session, view: VirtualView) -> dict[str, tuple[float, float]]:
    rows = db.scalars(
        select(VirtualViewPosition).where(VirtualViewPosition.view_id == view.id)
    ).all()
    return {r.node_id: (r.position_x, r.position_y) for r in rows}


def _coalesce(*values: str | None) -> str | None:
    """Return first non-empty value."""
    for v in values:
        if v and v.strip():
            return v
    return None


def _build_composite_members(
    db: Session, view: VirtualView
) -> list[VirtualMemberOut]:
    """Build merged member list with position overlay applied."""
    source_ids = flatten_tree_ids(db, view)
    source_order = {tid: i for i, tid in enumerate(source_ids)}

    rows = db.execute(
        select(Member, Tree.name)
        .join(Tree, Tree.id == Member.tree_id)
        .where(Member.tree_id.in_(source_ids))
    ).all()

    id_map = _build_id_map(db, view)
    overlay = _load_positions(db, view)

    # Determine if any overlay positions exist (hasLayout check happens via metadata).
    # Group members by their node_id (group_id for matched, member.id for unmatched).
    by_node: dict[str, list[tuple[Member, str]]] = {}
    for m, tree_name in rows:
        node_id = id_map.get(m.id, m.id)
        by_node.setdefault(node_id, []).append((m, tree_name))

    # Load match group info keyed by group_id → [member_id in primary order]
    match_rows = db.execute(
        select(
            VirtualViewMemberMatch.group_id,
            VirtualViewMemberMatch.member_id,
            VirtualViewMemberMatch.is_primary,
        ).where(VirtualViewMemberMatch.view_id == view.id)
    ).all()
    group_primary: dict[str, str] = {}
    for r in match_rows:
        if r.is_primary:
            group_primary[r.group_id] = r.member_id

    # X-offset fallback for when no overlay exists (first load before alignment).
    # Each tree is normalized to start at its own slot so the gap between trees
    # is always exactly GAP, regardless of where members originally sat in the DB.
    GAP = 600.0
    x_offset = 0.0
    tree_offsets: dict[str, float] = {}
    tree_min_x: dict[str, float] = {}
    for tid in source_ids:
        tree_members = [m for m, _ in rows if m.tree_id == tid]
        tree_offsets[tid] = x_offset
        if tree_members:
            min_x = min(m.position_x for m in tree_members)
            max_x = max(m.position_x for m in tree_members)
            tree_min_x[tid] = min_x
            x_offset += (max_x - min_x) + GAP

    def _node_sort_key(
        item: tuple[str, list[tuple[Member, str]]],
    ) -> tuple[int, str]:
        nid, node_rows = item
        return (min(source_order.get(m.tree_id, 999) for m, _ in node_rows), nid)

    result: list[VirtualMemberOut] = []
    for node_id, member_rows in sorted(by_node.items(), key=_node_sort_key):
        is_merged = len(member_rows) > 1 or node_id.startswith("vm_")
        primary_member_id = group_primary.get(node_id) if is_merged else None

        # Sort so the primary member is first (provides canonical field values).
        primary_id_captured = primary_member_id

        def _sort_key(
            pair: tuple[Member, str], _pid: str | None = primary_id_captured
        ) -> int:
            m, _ = pair
            if m.id == _pid:
                return -1
            return source_order.get(m.tree_id, 999)

        member_rows_sorted = sorted(member_rows, key=_sort_key)
        primary_m, primary_tree_name = member_rows_sorted[0]

        # Coalesce nullable fields from all members in source order.
        all_members = [m for m, _ in member_rows_sorted]
        coalesced_middle = _coalesce(*[m.middle_names for m in all_members])
        coalesced_baptismal = _coalesce(*[m.baptismal_name for m in all_members])
        coalesced_maiden = _coalesce(*[m.maiden_name for m in all_members])
        coalesced_image = _coalesce(*[m.image_data for m in all_members])
        coalesced_dob = _coalesce(*[m.date_of_birth for m in all_members])
        coalesced_dod = _coalesce(*[m.date_of_death for m in all_members])
        coalesced_add = _coalesce(*[m.additional_data for m in all_members])

        # Determine position: overlay first, then per-tree X-offset fallback.
        if node_id in overlay:
            pos_x, pos_y = overlay[node_id]
        else:
            offset = tree_offsets.get(primary_m.tree_id, 0.0)
            min_x_tree = tree_min_x.get(primary_m.tree_id, 0.0)
            pos_x = primary_m.position_x - min_x_tree + offset
            pos_y = primary_m.position_y

        out = MemberOut.model_validate(primary_m).model_dump(by_alias=True)
        out["id"] = node_id
        out["positionX"] = pos_x
        out["positionY"] = pos_y
        out["middleNames"] = coalesced_middle
        out["baptismalName"] = coalesced_baptismal
        out["maidenName"] = coalesced_maiden
        out["imageData"] = coalesced_image
        out["dateOfBirth"] = coalesced_dob
        out["dateOfDeath"] = coalesced_dod
        out["additionalData"] = coalesced_add

        source_tree_ids = [m.tree_id for m, _ in member_rows_sorted]
        source_tree_names = [tn for _, tn in member_rows_sorted]
        merged_from_ids = [m.id for m in all_members]

        result.append(
            VirtualMemberOut(
                **out,
                sourceTreeId=primary_m.tree_id,
                sourceTreeName=primary_tree_name,
                sourceTreeIds=source_tree_ids,
                sourceTreeNames=source_tree_names,
                mergedFromIds=merged_from_ids if is_merged else [],
                isMerged=is_merged,
            )
        )
    return result


# ---------------------------------------------------------------------------
# CRUD on view configuration
# ---------------------------------------------------------------------------


@router.get("", response_model=list[VirtualViewOut])
def list_virtual_views(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VirtualViewOut]:
    if user.is_admin:
        views = list(db.scalars(select(VirtualView)).all())
    else:
        views = list(
            db.scalars(
                select(VirtualView).where(VirtualView.owner_id == user.id)
            ).all()
        )
    views.sort(
        key=lambda v: (v.last_opened or "", v.created_at), reverse=True
    )
    accessible_ids = set(accessible_tree_ids(db, user))
    return [_view_out(db, v, user, accessible_ids) for v in views]


@router.post("", response_model=VirtualViewOut, status_code=201)
def create_virtual_view(
    payload: VirtualViewCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VirtualViewOut:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="A name is required")
    resolved = _classify_and_validate_sources(
        db, user, payload.source_tree_ids, target_view_id=None
    )
    groups = compute_match_groups(db, _flatten_resolved(db, resolved))
    if not groups:
        raise HTTPException(
            status_code=409, detail=VIRTUAL_VIEW_SOURCES_NO_OVERLAP
        )

    view = VirtualView(
        name=payload.name.strip(),
        owner_id=user.id,
        created_at=utcnow_iso(),
    )
    db.add(view)
    db.flush()
    _persist_sources(db, view, resolved)
    db.flush()
    persist_matches(db, view)
    record_admin_audit(
        db, actor=user, action="create", subject_type="virtual_view",
        subject_id=view.id, subject_label=view.name,
        details={"source_ids": payload.source_tree_ids},
    )
    db.commit()
    db.refresh(view)
    return _view_out(db, view, user)


@router.get("/{view_id}", response_model=VirtualViewOut)
def get_virtual_view(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VirtualViewOut:
    view = _resolve_view(db, view_id, user)
    view.last_opened = utcnow_iso()
    db.commit()
    return _view_out(db, view, user)


@router.patch("/{view_id}", response_model=VirtualViewOut)
def update_virtual_view(
    view_id: str,
    payload: VirtualViewUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VirtualViewOut:
    view = _resolve_view(db, view_id, user)
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can update a view")
    before = {
        "name": view.name,
        "source_ids": [src.tree_id or src.source_view_id for src in view.sources],
    }
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="A name is required")
        view.name = payload.name.strip()
    if payload.source_tree_ids is not None:
        resolved = _classify_and_validate_sources(
            db, user, payload.source_tree_ids, target_view_id=view.id
        )
        groups = compute_match_groups(db, _flatten_resolved(db, resolved))
        if not groups:
            raise HTTPException(
                status_code=409, detail=VIRTUAL_VIEW_SOURCES_NO_OVERLAP
            )
        for src in list(view.sources):
            db.delete(src)
        db.flush()
        _persist_sources(db, view, resolved)
        db.flush()
        # The sources relationship was loaded before the delete/re-add above;
        # expire it so persist_matches sees the new source list, not the stale
        # collection (otherwise matches are computed against the old trees).
        db.expire(view, ["sources"])
        persist_matches(db, view)
    if payload.name is not None or payload.source_tree_ids is not None:
        after = {
            "name": view.name,
            "source_ids": (
                payload.source_tree_ids
                if payload.source_tree_ids is not None
                else before["source_ids"]
            ),
        }
        record_admin_audit(
            db, actor=user, action="update", subject_type="virtual_view",
            subject_id=view.id, subject_label=view.name,
            details={"before": before, "after": after},
        )
    db.commit()
    db.refresh(view)
    return _view_out(db, view, user)


@router.delete("/{view_id}", status_code=204)
def delete_virtual_view(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    view = db.get(VirtualView, view_id)
    if view is None:
        raise HTTPException(status_code=404, detail="Virtual view not found")
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can delete a view")
    record_admin_audit(
        db, actor=user, action="delete", subject_type="virtual_view",
        subject_id=view.id, subject_label=view.name,
    )
    db.delete(view)
    db.commit()


@router.post("/{view_id}/recompute-matches")
def recompute_matches(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    view = _resolve_view(db, view_id, user)
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can recompute matches"
        )
    group_count = persist_matches(db, view)
    db.commit()
    merged_count = len(
        db.execute(
            select(VirtualViewMemberMatch.member_id).where(
                VirtualViewMemberMatch.view_id == view_id
            )
        ).fetchall()
    )
    return {"groupCount": group_count, "mergedMemberCount": merged_count}


# ---------------------------------------------------------------------------
# Composite read endpoints
# ---------------------------------------------------------------------------


@router.get("/{view_id}/metadata")
def get_virtual_view_metadata(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    view = _resolve_view(db, view_id, user)
    _ensure_matches(db, view)
    # The underlying real trees (nested views flattened) are the actual data
    # sources of the composite.
    source_ids = flatten_tree_ids(db, view)
    source_trees = [
        {"id": tid, "name": (db.get(Tree, tid) or Tree(name="")).name}
        for tid in source_ids
    ]
    # Count distinct nodes in the composite.
    id_map = _build_id_map(db, view)
    node_ids = set(id_map.get(mid, mid) for mid in (
        r[0] for r in db.execute(
            select(Member.id).where(Member.tree_id.in_(source_ids))
        ).all()
    ))
    overlap_count = db.execute(
        select(VirtualViewMemberMatch.group_id)
        .where(VirtualViewMemberMatch.view_id == view_id)
        .distinct()
    ).fetchall().__len__()
    pos_count = db.execute(
        select(VirtualViewPosition.node_id)
        .where(VirtualViewPosition.view_id == view_id)
    ).fetchall().__len__()
    has_layout = pos_count > 0 and pos_count >= len(node_ids)
    db.commit()
    return {
        "id": view.id,
        "name": view.name,
        "createdAt": view.created_at,
        "lastOpened": view.last_opened,
        "sourceTrees": source_trees,
        "overlapCount": overlap_count,
        "hasLayout": has_layout,
    }


@router.get("/{view_id}/members", response_model=list[VirtualMemberOut])
def list_virtual_members(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VirtualMemberOut]:
    view = _resolve_view(db, view_id, user)
    return _build_composite_members(db, view)


@router.get("/{view_id}/relations", response_model=list[RelationOut])
def list_virtual_relations(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RelationOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    id_map = _build_id_map(db, view)

    raw = list(
        db.scalars(
            select(Relation).where(Relation.tree_id.in_(source_ids))
        ).all()
    )

    # A merged node's parent edges must come from a single source member so the
    # node never accumulates >2 parents (which breaks dagre layout downstream).
    # Pick the primary member when it has parent relations of its own; otherwise
    # fall back to the first source member (by source-tree order) that has any —
    # this keeps the merged node connected even when only the secondary tree
    # records its parents (the typical cross-tree "connector" case).
    # Non-parent relations (married, sibling, …) are kept from all members.
    match_rows = db.execute(
        select(
            VirtualViewMemberMatch.group_id,
            VirtualViewMemberMatch.member_id,
            VirtualViewMemberMatch.is_primary,
        ).where(VirtualViewMemberMatch.view_id == view.id)
    ).all()
    members_with_parents = {
        rel.from_member_id for rel in raw if rel.relation_type == "parent"
    }
    merged_ids = [r.member_id for r in match_rows]
    tree_by_member: dict[str, str] = (
        dict(
            db.execute(
                select(Member.id, Member.tree_id).where(Member.id.in_(merged_ids))
            ).all()
        )
        if merged_ids
        else {}
    )
    source_order = {tid: i for i, tid in enumerate(source_ids)}
    members_by_group: dict[str, list[tuple[bool, str]]] = {}
    for r in match_rows:
        members_by_group.setdefault(r.group_id, []).append(
            (bool(r.is_primary), r.member_id)
        )
    parent_source_by_group: dict[str, str] = {}
    for gid, group_members in members_by_group.items():
        ordered = sorted(
            group_members,
            key=lambda t: (
                not t[0],
                source_order.get(tree_by_member.get(t[1], ""), 999),
            ),
        )
        chosen = next(
            (mid for _, mid in ordered if mid in members_with_parents), None
        )
        if chosen is not None:
            parent_source_by_group[gid] = chosen

    seen: set[tuple[str, str, str]] = set()
    result: list[RelationOut] = []
    for rel in raw:
        # For merged nodes, keep parent relations only from the chosen source
        # member of the group.
        if rel.relation_type == "parent":
            gid = id_map.get(rel.from_member_id, rel.from_member_id)
            if (
                gid != rel.from_member_id
                and parent_source_by_group.get(gid) != rel.from_member_id
            ):
                continue
        from_id = id_map.get(rel.from_member_id, rel.from_member_id)
        to_id = id_map.get(rel.to_member_id, rel.to_member_id)
        if from_id == to_id:
            continue  # self-loop from both endpoints merging to the same node
        key = (from_id, to_id, rel.relation_type)
        if key in seen:
            continue
        seen.add(key)
        # Build a RelationOut with rewritten ids.
        out = RelationOut.model_validate(rel)
        result.append(
            RelationOut(
                from_member_id=from_id,
                to_member_id=to_id,
                relation_type=out.relation_type,
            )
        )
    return result


@router.get("/{view_id}/diseases", response_model=list[DiseaseOut])
def list_virtual_diseases(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DiseaseOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    id_map = _build_id_map(db, view)
    diseases = list(
        db.scalars(
            select(MemberDisease)
            .join(Member, Member.id == MemberDisease.member_id)
            .where(Member.tree_id.in_(source_ids))
        ).all()
    )
    seen: set[tuple[str, str]] = set()
    result: list[DiseaseOut] = []
    for d in diseases:
        node_id = id_map.get(d.member_id, d.member_id)
        key = (node_id, (d.name or "").strip().lower())
        if key in seen:
            continue
        seen.add(key)
        out = DiseaseOut.model_validate(d)
        result.append(DiseaseOut(member_id=node_id, name=out.name))
    return result


# ---------------------------------------------------------------------------
# Composite feature endpoints (full read parity, aggregated live from sources)
# ---------------------------------------------------------------------------
#
# Every feature view a normal tree exposes works on a virtual tree by reading
# rows whose ``tree_id`` is in the flattened source set and remapping member ids
# to the composite node ids. Two id schemes:
#   * Links (gallery / events / stories / citations) use the *node* id map so
#     they line up with the merged members the UI renders.
#   * Analytics (statistics / quality) collapse each match group to its primary
#     member so people are counted once, with consistent real ids.


def _aggregate(db: Session, source_ids: list[str], model: type) -> list:
    """All rows of a tree-scoped *model* across the flattened source trees."""
    return list(
        db.scalars(select(model).where(model.tree_id.in_(source_ids))).all()
    )


def _remap_member_links(
    db: Session,
    view: VirtualView,
    link_model: type,
    member_attr: str,
    other_attr: str,
) -> list[tuple[str, str]]:
    """``(other_id, node_id)`` pairs with the member side remapped + de-duped."""
    source_ids = flatten_tree_ids(db, view)
    id_map = _build_id_map(db, view)
    rows = db.execute(
        select(
            getattr(link_model, other_attr), getattr(link_model, member_attr)
        )
        .join(Member, Member.id == getattr(link_model, member_attr))
        .where(Member.tree_id.in_(source_ids))
    ).all()
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for other_id, member_id in rows:
        node_id = id_map.get(member_id, member_id)
        key = (other_id, node_id)
        if key in seen:
            continue
        seen.add(key)
        out.append((other_id, node_id))
    return out


def _primary_member_map(db: Session, view: VirtualView) -> dict[str, str]:
    """``member_id -> primary member id`` (non-primary collapse to primary)."""
    _ensure_matches(db, view)
    rows = db.execute(
        select(
            VirtualViewMemberMatch.member_id,
            VirtualViewMemberMatch.group_id,
            VirtualViewMemberMatch.is_primary,
        ).where(VirtualViewMemberMatch.view_id == view.id)
    ).all()
    group_primary = {r.group_id: r.member_id for r in rows if r.is_primary}
    return {r.member_id: group_primary.get(r.group_id, r.member_id) for r in rows}


def _analytics_members(db: Session, view: VirtualView) -> list[Member]:
    """Distinct people (match groups collapsed to their primary member)."""
    source_ids = flatten_tree_ids(db, view)
    members = _aggregate(db, source_ids, Member)
    primary_map = _primary_member_map(db, view)
    return [m for m in members if primary_map.get(m.id, m.id) == m.id]


def _analytics_relations(
    db: Session, view: VirtualView, primary_map: dict[str, str]
) -> list[Relation]:
    """Relations remapped onto primary member ids, self-loops + dupes dropped."""
    source_ids = flatten_tree_ids(db, view)
    seen: set[tuple[str, str, str]] = set()
    out: list[Relation] = []
    for r in _aggregate(db, source_ids, Relation):
        f = primary_map.get(r.from_member_id, r.from_member_id)
        t = primary_map.get(r.to_member_id, r.to_member_id)
        if f == t:
            continue
        key = (f, t, r.relation_type)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            Relation(
                tree_id=view.id,
                from_member_id=f,
                to_member_id=t,
                relation_type=r.relation_type,
            )
        )
    return out


@router.get("/{view_id}/gallery/images", response_model=list[GalleryImageOut])
def list_virtual_gallery_images(
    view_id: str,
    _: None = Depends(require_feature("gallery")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GalleryImageOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    return [
        GalleryImageOut.model_validate(i)
        for i in _aggregate(db, source_ids, GalleryImage)
    ]


@router.get("/{view_id}/gallery/links", response_model=list[GalleryLinkOut])
def list_virtual_gallery_links(
    view_id: str,
    _: None = Depends(require_feature("gallery")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GalleryLinkOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    id_map = _build_id_map(db, view)
    rows = db.scalars(
        select(GalleryMemberLink)
        .join(Member, Member.id == GalleryMemberLink.member_id)
        .where(Member.tree_id.in_(source_ids))
    ).all()
    seen: set[tuple[str, str]] = set()
    links: list[GalleryLinkOut] = []
    for link in rows:
        member_id = id_map.get(link.member_id, link.member_id)
        key = (link.gallery_image_id, member_id)
        if key in seen:
            continue
        seen.add(key)
        links.append(
            GalleryLinkOut(
                gallery_image_id=link.gallery_image_id,
                member_id=member_id,
                x=link.x,
                y=link.y,
                w=link.w,
                h=link.h,
            )
        )
    return links


@router.get("/{view_id}/events", response_model=list[EventOut])
def list_virtual_events(
    view_id: str,
    _: None = Depends(require_feature("events")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[EventOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    events = _aggregate(db, source_ids, Event)
    event_ids = [e.id for e in events]
    doc_map: dict[str, list[str]] = {}
    if event_ids:
        rows = db.execute(
            select(EventDocumentLink.event_id, EventDocumentLink.document_id).where(
                EventDocumentLink.event_id.in_(event_ids)
            )
        ).all()
        for eid, did in rows:
            doc_map.setdefault(eid, []).append(did)
    return [
        EventOut.model_validate(e).model_copy(
            update={"document_ids": doc_map.get(e.id, [])}
        )
        for e in events
    ]


@router.get("/{view_id}/events/links", response_model=list[EventLinkOut])
def list_virtual_event_links(
    view_id: str,
    _: None = Depends(require_feature("events")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[EventLinkOut]:
    view = _resolve_view(db, view_id, user)
    pairs = _remap_member_links(
        db, view, EventMemberLink, "member_id", "event_id"
    )
    return [EventLinkOut(event_id=other, member_id=node) for other, node in pairs]


@router.get("/{view_id}/stories", response_model=list[StoryOut])
def list_virtual_stories(
    view_id: str,
    _: None = Depends(require_feature("stories")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[StoryOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    stories = db.scalars(
        select(Story).where(Story.tree_id.in_(source_ids))
    ).all()
    story_ids = [s.id for s in stories]
    doc_map: dict[str, list[str]] = {}
    if story_ids:
        rows = db.execute(
            select(StoryDocumentLink.story_id, StoryDocumentLink.document_id).where(
                StoryDocumentLink.story_id.in_(story_ids)
            )
        ).all()
        for sid, did in rows:
            doc_map.setdefault(sid, []).append(did)
    return [
        StoryOut.model_validate(s).model_copy(
            update={"document_ids": doc_map.get(s.id, [])}
        )
        for s in stories
    ]


@router.get("/{view_id}/stories/links", response_model=list[StoryLinkOut])
def list_virtual_story_links(
    view_id: str,
    _: None = Depends(require_feature("stories")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[StoryLinkOut]:
    view = _resolve_view(db, view_id, user)
    pairs = _remap_member_links(
        db, view, StoryMemberLink, "member_id", "story_id"
    )
    return [StoryLinkOut(story_id=other, member_id=node) for other, node in pairs]


@router.get("/{view_id}/documents", response_model=list[DocumentOut])
def list_virtual_documents(
    view_id: str,
    # The flag/domain key is kept as "sources" for backward compatibility; the
    # feature is now presented as "Documents".
    _: None = Depends(require_feature("sources")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DocumentOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    id_map = _build_id_map(db, view)
    documents = db.scalars(
        select(Document)
        .where(Document.tree_id.in_(source_ids))
        .options(selectinload(Document.files))
    ).all()
    doc_ids = [d.id for d in documents]
    member_map: dict[str, list[str]] = {}
    if doc_ids:
        rows = db.execute(
            select(DocumentMemberLink.document_id, DocumentMemberLink.member_id).where(
                DocumentMemberLink.document_id.in_(doc_ids)
            )
        ).all()
        for did, mid in rows:
            member_map.setdefault(did, []).append(id_map.get(mid, mid))
    return [
        DocumentOut.model_validate(d).model_copy(
            update={"member_ids": member_map.get(d.id, [])}
        )
        for d in documents
    ]


@router.get("/{view_id}/activity", response_model=ActivityPageOut)
def list_virtual_activity(
    view_id: str,
    _: None = Depends(require_feature("activity_log")),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    actor: str | None = Query(default=None),
    action: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActivityPageOut:
    view = _resolve_view(db, view_id, user)
    source_ids = flatten_tree_ids(db, view)
    return activity_page(
        db,
        source_ids,
        limit=limit,
        offset=offset,
        actor=actor,
        action=action,
        target_type=target_type,
        hidden_target_types=hidden_activity_target_types(db, user, source_ids),
    )


@router.post("/{view_id}/geocode", response_model=list[GeocodeOut])
def virtual_geocode_batch(
    view_id: str,
    payload: GeocodeRequest,
    _: None = Depends(require_feature("map")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GeocodeOut]:
    _resolve_view(db, view_id, user)  # auth only — geocode cache is global
    return resolve_batch(db, payload.locations)


@router.get("/{view_id}/geocode/preview", response_model=GeocodeOut)
def virtual_geocode_preview(
    view_id: str,
    q: str = Query(..., min_length=1),
    _: None = Depends(require_feature("map")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GeocodeOut:
    _resolve_view(db, view_id, user)
    return resolve_single(db, q)


@router.get("/{view_id}/statistics", response_model=StatisticsReport)
def get_virtual_statistics(
    view_id: str,
    _: None = Depends(require_feature("statistics")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StatisticsReport:
    view = _resolve_view(db, view_id, user)
    members = _analytics_members(db, view)
    return compute_statistics(members, view.id)


@router.get("/{view_id}/quality-report", response_model=QualityReport)
def get_virtual_quality_report(
    view_id: str,
    _: None = Depends(require_feature("quality_report")),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QualityReport:
    view = _resolve_view(db, view_id, user)
    members = _analytics_members(db, view)
    primary_map = _primary_member_map(db, view)
    relations = _analytics_relations(db, view, primary_map)
    raw_issues = run_quality_checks(members, relations)
    return QualityReport(
        tree_id=view.id,
        total_members=len(members),
        issues=[QualityIssue(**i) for i in raw_issues],
    )


@router.patch("/{view_id}/members/positions", status_code=204)
def save_virtual_positions(
    view_id: str,
    positions: list[VirtualPositionItem],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Persist alignment positions for this view."""
    view = _resolve_view(db, view_id, user)
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can save layout")
    for item in positions:
        existing = db.get(VirtualViewPosition, (view_id, item.id))
        if existing:
            existing.position_x = item.position_x
            existing.position_y = item.position_y
        else:
            db.add(
                VirtualViewPosition(
                    view_id=view_id,
                    node_id=item.id,
                    position_x=item.position_x,
                    position_y=item.position_y,
                )
            )
    db.commit()
    event_bus.publish([view.owner_id], "tree.layout_changed", {"tree_id": view_id})
