"""The v1 position-overlay conversion rule (#986), consumed by #987's executor."""

from app.models.virtual_view import VirtualViewMemberMatch, VirtualViewPosition
from app.services.saved_views.position_conversion import (
    UNRESOLVED_OFFSET_STEP,
    SavedPosition,
    convert_positions,
    fan_out_group,
    group_member_ids,
    primary_member_id,
)


def _pos(view_id: str, node_id: str, x: float, y: float) -> VirtualViewPosition:
    return VirtualViewPosition(
        view_id=view_id, node_id=node_id, position_x=x, position_y=y
    )


def test_real_member_positions_map_directly():
    positions = [_pos("vv_1", "member-a", 1.0, 2.0), _pos("vv_1", "member-b", 3.0, 4.0)]
    direct, anchors = convert_positions(positions)
    assert anchors == []
    assert direct == [
        SavedPosition("member-a", 1.0, 2.0),
        SavedPosition("member-b", 3.0, 4.0),
    ]


def test_match_group_anchor_is_retained_verbatim():
    positions = [_pos("vv_1", "vm_deadbeef", 10.0, 20.0)]
    direct, anchors = convert_positions(positions)
    assert direct == []
    assert anchors == [SavedPosition("vm_deadbeef", 10.0, 20.0)]


def test_no_overlay_is_silently_discarded():
    positions = [
        _pos("vv_1", "member-a", 1.0, 2.0),
        _pos("vv_1", "vm_group1", 5.0, 5.0),
    ]
    direct, anchors = convert_positions(positions)
    assert len(direct) + len(anchors) == len(positions)


def test_fan_out_group_keeps_primary_at_anchor_and_offsets_the_rest():
    anchor = SavedPosition("vm_group1", 100.0, 200.0)
    result = fan_out_group(anchor, ["m2", "m1", "m3"], primary_id="m1")

    assert result[0] == SavedPosition("m1", 100.0, 200.0)
    # Deterministic sorted-id order for everyone else, non-overlapping offsets.
    assert result[1] == SavedPosition("m2", 100.0 + UNRESOLVED_OFFSET_STEP, 200.0)
    assert result[2] == SavedPosition("m3", 100.0 + 2 * UNRESOLVED_OFFSET_STEP, 200.0)


def test_fan_out_group_is_deterministic_across_runs():
    anchor = SavedPosition("vm_group1", 0.0, 0.0)
    first = fan_out_group(anchor, ["m3", "m1", "m2"], primary_id="m1")
    second = fan_out_group(anchor, ["m1", "m2", "m3"], primary_id="m1")
    assert first == second


def test_primary_and_group_member_lookup():
    matches = [
        VirtualViewMemberMatch(
            view_id="vv_1", member_id="m1", group_id="g1", is_primary=True
        ),
        VirtualViewMemberMatch(
            view_id="vv_1", member_id="m2", group_id="g1", is_primary=False
        ),
        VirtualViewMemberMatch(
            view_id="vv_1", member_id="m3", group_id="g2", is_primary=True
        ),
    ]
    assert primary_member_id(matches, "g1") == "m1"
    assert primary_member_id(matches, "g2") == "m3"
    assert primary_member_id(matches, "missing") is None
    assert group_member_ids(matches, "g1") == ["m1", "m2"]
