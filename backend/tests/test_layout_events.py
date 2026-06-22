"""Tests that position saves emit tree.layout_changed SSE events."""

from unittest.mock import patch

import pytest

from tests.conftest import API, add_member, auth, make_tree, make_user


@pytest.fixture()
def owner(db):
    return make_user(db, "owner")


@pytest.fixture()
def tree(db, owner):
    return make_tree(db, owner)


@pytest.fixture()
def headers(owner):
    return auth(owner)


def test_save_positions_emits_layout_changed(client, db, tree, headers):
    member = add_member(db, tree, "m1")
    with patch("app.api.routes.members.publish_tree_event") as m:
        res = client.patch(
            f"{API}/trees/{tree.id}/members/positions",
            json=[{"id": member.id, "position_x": 10.0, "position_y": 20.0}],
            headers=headers,
        )
        assert res.status_code == 204, res.text
    assert any(
        c.args[2] == "tree.layout_changed" and c.args[3] == {"tree_id": tree.id}
        for c in m.call_args_list
    )


def test_empty_positions_does_not_emit_layout_changed(client, db, tree, headers):
    with patch("app.api.routes.members.publish_tree_event") as m:
        res = client.patch(
            f"{API}/trees/{tree.id}/members/positions",
            json=[],
            headers=headers,
        )
        assert res.status_code == 204, res.text
    m.assert_not_called()
