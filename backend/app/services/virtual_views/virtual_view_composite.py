"""Compose a virtual view's live content from its flattened source workspaces.

Every feature a normal tree exposes works on a virtual tree by reading rows
whose ``workspace_id`` is in the flattened source set and remapping member ids
through the persisted match groups. Two id schemes:

  * Links (gallery / events / stories / documents) use the *node* id map so
    they line up with the merged members the UI renders.
  * Analytics (statistics / quality) collapse each match group to its primary
    member so people are counted once, with consistent real ids.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Member, MemberDisease, Relation, Workspace
from app.models.virtual_view import (
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
)
from app.schemas.family import DiseaseOut, MemberOut, RelationOut
from app.schemas.virtual_view import VirtualMemberOut
from app.services.virtual_views.virtual_view_matching import persist_matches
from app.services.virtual_views.virtual_view_sources import flatten_workspace_ids


def ensure_matches(db: Session, view: VirtualView) -> None:
    """Lazily compute matches for legacy views that predate this feature."""
    if view.matches_computed_at is None:
        persist_matches(db, view)
        db.flush()


def build_id_map(db: Session, view: VirtualView) -> dict[str, str]:
    """Return {original_member_id: node_id} using persisted match groups."""
    ensure_matches(db, view)
    rows = db.execute(
        select(VirtualViewMemberMatch.member_id, VirtualViewMemberMatch.group_id).where(
            VirtualViewMemberMatch.view_id == view.id
        )
    ).all()
    return {r.member_id: r.group_id for r in rows}


def load_positions(db: Session, view: VirtualView) -> dict[str, tuple[float, float]]:
    rows = db.scalars(
        select(VirtualViewPosition).where(VirtualViewPosition.view_id == view.id)
    ).all()
    return {r.node_id: (r.position_x, r.position_y) for r in rows}


def primary_member_map(db: Session, view: VirtualView) -> dict[str, str]:
    """``member_id -> primary member id`` (non-primary collapse to primary)."""
    ensure_matches(db, view)
    rows = db.execute(
        select(
            VirtualViewMemberMatch.member_id,
            VirtualViewMemberMatch.group_id,
            VirtualViewMemberMatch.is_primary,
        ).where(VirtualViewMemberMatch.view_id == view.id)
    ).all()
    group_primary = {r.group_id: r.member_id for r in rows if r.is_primary}
    return {r.member_id: group_primary.get(r.group_id, r.member_id) for r in rows}


def aggregate(db: Session, source_ids: list[str], model: type) -> list:
    """All rows of a tree-scoped *model* across the flattened source workspaces."""
    return list(db.scalars(select(model).where(model.workspace_id.in_(source_ids))).all())


def remap_member_links(
    db: Session,
    view: VirtualView,
    link_model: type,
    member_attr: str,
    other_attr: str,
) -> list[tuple[str, str]]:
    """``(other_id, node_id)`` pairs with the member side remapped + de-duped."""
    source_ids = flatten_workspace_ids(db, view)
    id_map = build_id_map(db, view)
    rows = db.execute(
        select(getattr(link_model, other_attr), getattr(link_model, member_attr))
        .join(Member, Member.id == getattr(link_model, member_attr))
        .where(Member.workspace_id.in_(source_ids))
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


def analytics_members(db: Session, view: VirtualView) -> list[Member]:
    """Distinct people (match groups collapsed to their primary member)."""
    source_ids = flatten_workspace_ids(db, view)
    members = aggregate(db, source_ids, Member)
    primary_map = primary_member_map(db, view)
    return [m for m in members if primary_map.get(m.id, m.id) == m.id]


def analytics_relations(
    db: Session, view: VirtualView, primary_map: dict[str, str]
) -> list[Relation]:
    """Relations remapped onto primary member ids, self-loops + dupes dropped."""
    source_ids = flatten_workspace_ids(db, view)
    seen: set[tuple[str, str, str]] = set()
    out: list[Relation] = []
    for r in aggregate(db, source_ids, Relation):
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
                workspace_id=view.id,
                from_member_id=f,
                to_member_id=t,
                relation_type=r.relation_type,
            )
        )
    return out


def _coalesce(*values: str | None) -> str | None:
    """Return first non-empty value."""
    for v in values:
        if v and v.strip():
            return v
    return None


def build_composite_members(db: Session, view: VirtualView) -> list[VirtualMemberOut]:
    """Build merged member list with position overlay applied."""
    source_ids = flatten_workspace_ids(db, view)
    source_order = {tid: i for i, tid in enumerate(source_ids)}

    rows = db.execute(
        select(Member, Workspace.name)
        .join(Workspace, Workspace.id == Member.workspace_id)
        .where(Member.workspace_id.in_(source_ids))
    ).all()

    id_map = build_id_map(db, view)
    overlay = load_positions(db, view)

    # Determine if any overlay positions exist (hasLayout check happens via metadata).
    # Group members by their node_id (group_id for matched, member.id for unmatched).
    by_node: dict[str, list[tuple[Member, str]]] = {}
    for m, workspace_name in rows:
        node_id = id_map.get(m.id, m.id)
        by_node.setdefault(node_id, []).append((m, workspace_name))

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
    # Each tree is normalized to start at its own slot so the gap between workspaces
    # is always exactly GAP, regardless of where members originally sat in the DB.
    GAP = 600.0
    x_offset = 0.0
    tree_offsets: dict[str, float] = {}
    tree_min_x: dict[str, float] = {}
    for tid in source_ids:
        tree_members = [m for m, _ in rows if m.workspace_id == tid]
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
        return (min(source_order.get(m.workspace_id, 999) for m, _ in node_rows), nid)

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
            return source_order.get(m.workspace_id, 999)

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
            offset = tree_offsets.get(primary_m.workspace_id, 0.0)
            min_x_tree = tree_min_x.get(primary_m.workspace_id, 0.0)
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

        source_workspace_ids = [m.workspace_id for m, _ in member_rows_sorted]
        source_workspace_names = [tn for _, tn in member_rows_sorted]
        merged_from_ids = [m.id for m in all_members]

        result.append(
            VirtualMemberOut(
                **out,
                sourceWorkspaceId=primary_m.workspace_id,
                sourceWorkspaceName=primary_tree_name,
                sourceWorkspaceIds=source_workspace_ids,
                sourceWorkspaceNames=source_workspace_names,
                mergedFromIds=merged_from_ids if is_merged else [],
                isMerged=is_merged,
            )
        )
    return result


def build_composite_relations(db: Session, view: VirtualView) -> list[RelationOut]:
    """Merge relations across sources, remapped onto composite node ids."""
    source_ids = flatten_workspace_ids(db, view)
    id_map = build_id_map(db, view)

    raw = list(
        db.scalars(select(Relation).where(Relation.workspace_id.in_(source_ids))).all()
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
                select(Member.id, Member.workspace_id).where(Member.id.in_(merged_ids))
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
        chosen = next((mid for _, mid in ordered if mid in members_with_parents), None)
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
        result.append(
            RelationOut(
                from_member_id=from_id,
                to_member_id=to_id,
                relation_type=rel.relation_type,
            )
        )
    return result


def build_composite_diseases(db: Session, view: VirtualView) -> list[DiseaseOut]:
    """Merge disease records across sources, remapped + de-duped by node."""
    source_ids = flatten_workspace_ids(db, view)
    id_map = build_id_map(db, view)
    diseases = list(
        db.scalars(
            select(MemberDisease)
            .join(Member, Member.id == MemberDisease.member_id)
            .where(Member.workspace_id.in_(source_ids))
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
        result.append(out.model_copy(update={"member_id": node_id}))
    return result
