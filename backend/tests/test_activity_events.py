"""Tests that content mutations emit activity.entry_added SSE events."""

from unittest.mock import patch

from tests.conftest import API

_TS = "2000-01-01T00:00:00Z"


def _activity_event(mock, workspace_id):
    """Assert activity.entry_added was published for workspace_id."""
    return any(
        c.args[2] == "activity.entry_added"
        and c.args[3] == {"workspace_id": workspace_id}
        for c in mock.call_args_list
    )


def test_create_member_emits_activity_entry_added(client, db, tree, headers):
    with patch("app.api.routes.members.publish_workspace_event") as m:
        res = client.post(
            f"{API}/workspaces/{tree.id}/members",
            json={"id": "m1", "first_name": "Ada"},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _activity_event(m, tree.id)


def test_create_event_emits_activity_entry_added(client, db, tree, headers):
    with patch("app.api.routes.events.publish_workspace_event") as m:
        res = client.post(
            f"{API}/workspaces/{tree.id}/events",
            json={"id": "ev1", "event_type": "birth", "date": "2000", "created_at": _TS},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _activity_event(m, tree.id)


def test_create_story_emits_activity_entry_added(client, db, tree, headers):
    with patch("app.api.routes.stories.publish_workspace_event") as m:
        res = client.post(
            f"{API}/workspaces/{tree.id}/stories",
            json={"id": "s1", "title": "A tale", "created_at": _TS, "updated_at": _TS},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _activity_event(m, tree.id)
