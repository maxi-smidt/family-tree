"""v1 position-overlay conversion rule (#986), consumed by the executor that
actually migrates ``virtual_view*`` rows to saved views (#987).

Pure and read-only: it maps ``VirtualViewPosition``/``VirtualViewMemberMatch``
rows to ``SavedPosition`` values a caller then persists as
``SavedViewPosition`` rows. No overlay is ever silently discarded here — a
real member-id position maps directly (``convert_positions``' ``direct``); a
synthetic match-group anchor (``vm_`` prefixed — see
``virtual_view_matching.group_id_for``) is retained verbatim as the pending
suggestion's anchor (``anchors``) rather than dropped just because a saved
view has no match-group concept of its own.

``fan_out_group`` is the other half of the rule: it turns one anchor plus a
match group's member ids into deterministic, non-overlapping per-member
positions. The executor calls it either to render an still-undecided
suggestion (every member needs its own node position) or to materialize a
rejected one; an *accepted* suggestion instead collapses the group onto the
merged member, which simply keeps the anchor position outright (no fan-out
needed).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.virtual_view import VirtualViewMemberMatch, VirtualViewPosition

# Horizontal spacing (canvas units) between members fanned out from a shared
# match-group anchor.
UNRESOLVED_OFFSET_STEP = 60.0


@dataclass(frozen=True)
class SavedPosition:
    node_id: str
    position_x: float
    position_y: float


def convert_positions(
    positions: list[VirtualViewPosition],
) -> tuple[list[SavedPosition], list[SavedPosition]]:
    """Split a virtual view's overlay into ``(direct, anchors)`` under the v1 rule."""
    direct: list[SavedPosition] = []
    anchors: list[SavedPosition] = []
    for pos in positions:
        target = anchors if pos.node_id.startswith("vm_") else direct
        target.append(SavedPosition(pos.node_id, pos.position_x, pos.position_y))
    return direct, anchors


def fan_out_group(
    anchor: SavedPosition, member_ids: list[str], primary_id: str
) -> list[SavedPosition]:
    """Deterministic, non-overlapping per-member positions for one match
    group's anchor.

    The primary member (``VirtualViewMemberMatch.is_primary`` — see
    ``virtual_view_matching.persist_matches``) keeps the anchor position
    exactly, since accepting the suggestion merges the group onto that
    member. Every other member fans out along the x axis in sorted-id order,
    so recomputing this against the same group always yields the same
    layout — rejecting the suggestion then simply keeps each member at its
    fanned-out position rather than collapsing them back onto one node.
    """
    others = sorted(mid for mid in member_ids if mid != primary_id)
    out = [SavedPosition(primary_id, anchor.position_x, anchor.position_y)]
    for i, member_id in enumerate(others, start=1):
        out.append(
            SavedPosition(
                member_id,
                anchor.position_x + i * UNRESOLVED_OFFSET_STEP,
                anchor.position_y,
            )
        )
    return out


def primary_member_id(
    matches: list[VirtualViewMemberMatch], group_id: str
) -> str | None:
    for m in matches:
        if m.group_id == group_id and m.is_primary:
            return m.member_id
    return None


def group_member_ids(matches: list[VirtualViewMemberMatch], group_id: str) -> list[str]:
    return [m.member_id for m in matches if m.group_id == group_id]
