"""Virtual multi-tree views — read-only composites of 2+ trees."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import accessible_tree_ids, get_current_user, role_for
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import Member, MemberDisease, Relation, RelationType, Tree, User
from app.models.virtual_view import (
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
    VirtualViewSource,
)
from app.schemas.family import DiseaseOut, MemberOut, RelationOut, RelationTypeOut
from app.schemas.virtual_view import (
    VirtualMemberOut,
    VirtualPositionItem,
    VirtualViewCreate,
    VirtualViewOut,
    VirtualViewSourceOut,
    VirtualViewUpdate,
)
from app.services.virtual_view_matching import compute_match_groups, persist_matches

router = APIRouter(prefix="/virtual-views", tags=["virtual-views"])

VIRTUAL_VIEW_SOURCE_ACCESS_REVOKED = "virtual_view_source_access_revoked"
VIRTUAL_VIEW_SOURCES_MISSING = "virtual_view_sources_missing"
VIRTUAL_VIEW_SOURCES_NO_OVERLAP = "virtual_view_sources_no_overlap"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _check_source_access(db: Session, view: VirtualView, user: User) -> None:
    """Raise 403/409 when the user has lost access to a source or too few remain."""
    if len(view.sources) < 2:
        raise HTTPException(status_code=409, detail=VIRTUAL_VIEW_SOURCES_MISSING)
    for src in view.sources:
        tree = db.get(Tree, src.tree_id)
        if tree is None or (not user.is_admin and role_for(db, tree, user) is None):
            raise HTTPException(
                status_code=403, detail=VIRTUAL_VIEW_SOURCE_ACCESS_REVOKED
            )


def _resolve_view(db: Session, view_id: str, user: User) -> VirtualView:
    view = db.get(VirtualView, view_id)
    if view is None:
        raise HTTPException(status_code=404, detail="Virtual view not found")
    if view.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=404, detail="Virtual view not found")
    _check_source_access(db, view, user)
    return view


def _view_out(
    db: Session, view: VirtualView, user: User, accessible_ids: set[str] | None = None
) -> VirtualViewOut:
    if accessible_ids is None:
        accessible_ids = set(accessible_tree_ids(db, user))
    sources = [
        VirtualViewSourceOut(
            tree_id=src.tree_id,
            tree_name=(db.get(Tree, src.tree_id) or Tree(name="")).name,
            accessible=src.tree_id in accessible_ids,
        )
        for src in view.sources
    ]
    return VirtualViewOut(
        id=view.id,
        name=view.name,
        owner_id=view.owner_id,
        created_at=view.created_at,
        last_opened=view.last_opened,
        sources=sources,
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
    source_ids = [s.tree_id for s in view.sources]
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
            min_x = min(m.positionX for m in tree_members)
            max_x = max(m.positionX for m in tree_members)
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
        coalesced_maiden = _coalesce(*[m.maidenName for m in all_members])
        coalesced_image = _coalesce(*[m.imageData for m in all_members])
        coalesced_dob = _coalesce(*[m.dateOfBirth for m in all_members])
        coalesced_dod = _coalesce(*[m.dateOfDeath for m in all_members])
        coalesced_add = _coalesce(*[m.additionalData for m in all_members])

        # Determine position: overlay first, then per-tree X-offset fallback.
        if node_id in overlay:
            pos_x, pos_y = overlay[node_id]
        else:
            offset = tree_offsets.get(primary_m.tree_id, 0.0)
            min_x_tree = tree_min_x.get(primary_m.tree_id, 0.0)
            pos_x = primary_m.positionX - min_x_tree + offset
            pos_y = primary_m.positionY

        out = MemberOut.model_validate(primary_m).model_dump()
        out["id"] = node_id
        out["positionX"] = pos_x
        out["positionY"] = pos_y
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
    unique_ids = list(dict.fromkeys(payload.source_tree_ids))
    if len(unique_ids) < 2:
        raise HTTPException(
            status_code=400, detail="At least 2 distinct source trees required"
        )
    accessible = set(accessible_tree_ids(db, user))
    for tree_id in unique_ids:
        if tree_id not in accessible:
            raise HTTPException(
                status_code=403,
                detail=f"No access to tree {tree_id}",
            )

    groups = compute_match_groups(db, unique_ids)
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
    for i, tree_id in enumerate(unique_ids):
        db.add(VirtualViewSource(view_id=view.id, tree_id=tree_id, position=i))
    db.flush()
    persist_matches(db, view)
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
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="A name is required")
        view.name = payload.name.strip()
    if payload.source_tree_ids is not None:
        unique_ids = list(dict.fromkeys(payload.source_tree_ids))
        if len(unique_ids) < 2:
            raise HTTPException(
                status_code=400, detail="At least 2 distinct source trees required"
            )
        accessible = set(accessible_tree_ids(db, user))
        for tree_id in unique_ids:
            if tree_id not in accessible:
                raise HTTPException(
                    status_code=403, detail=f"No access to tree {tree_id}"
                )
        groups = compute_match_groups(db, unique_ids)
        if not groups:
            raise HTTPException(
                status_code=409, detail=VIRTUAL_VIEW_SOURCES_NO_OVERLAP
            )
        for src in list(view.sources):
            db.delete(src)
        db.flush()
        for i, tree_id in enumerate(unique_ids):
            db.add(VirtualViewSource(view_id=view.id, tree_id=tree_id, position=i))
        db.flush()
        persist_matches(db, view)
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
    source_trees = [
        {"id": src.tree_id, "name": (db.get(Tree, src.tree_id) or Tree(name="")).name}
        for src in view.sources
    ]
    # Count distinct nodes in the composite.
    source_ids = [s.tree_id for s in view.sources]
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
    source_ids = [s.tree_id for s in view.sources]
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
    source_ids = [s.tree_id for s in view.sources]
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


@router.get("/{view_id}/relation-types", response_model=list[RelationTypeOut])
def list_virtual_relation_types(
    view_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RelationTypeOut]:
    view = _resolve_view(db, view_id, user)
    source_ids = [s.tree_id for s in view.sources]
    seen: set[str] = set()
    result: list[RelationTypeOut] = []
    for rt_id in db.scalars(
        select(RelationType.id).where(RelationType.tree_id.in_(source_ids))
    ).all():
        if rt_id not in seen:
            seen.add(rt_id)
            result.append(RelationTypeOut(id=rt_id))
    return result


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
            existing.position_x = item.positionX
            existing.position_y = item.positionY
        else:
            db.add(
                VirtualViewPosition(
                    view_id=view_id,
                    node_id=item.id,
                    position_x=item.positionX,
                    position_y=item.positionY,
                )
            )
    db.commit()
