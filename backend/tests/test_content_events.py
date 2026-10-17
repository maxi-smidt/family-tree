"""Tests that content mutations emit workspace.content_changed SSE events."""

from unittest.mock import patch

from tests.conftest import API, add_member

_TS = "2000-01-01T00:00:00Z"


def _events(mock):
    """Return list of (event_type, data) from publish_workspace_event mock calls."""
    return [(c.args[2], c.args[3]) for c in mock.call_args_list]


def _content_event(events, workspace_id, domain):
    return any(
        et == "workspace.content_changed"
        and d == {"workspace_id": workspace_id, "domain": domain}
        for et, d in events
    )


def test_create_member_emits_content_changed(client, db, tree, headers):
    with patch("app.api.routes.members.publish_workspace_event") as m:
        client.post(
            f"{API}/workspaces/{tree.id}/members",
            json={"id": "m-new", "first_name": "Ada"},
            headers=headers,
        )
    assert _content_event(_events(m), tree.id, "member")


def test_update_member_emits_content_changed(client, db, tree, headers):
    member = add_member(db, tree, "m1", first_name="Ada")
    with patch("app.services.members.member_update.publish_workspace_event") as m:
        client.patch(
            f"{API}/workspaces/{tree.id}/members/{member.id}",
            json={"first_name": "Eve"},
            headers=headers,
        )
    assert _content_event(_events(m), tree.id, "member")


def test_delete_member_emits_content_changed(client, db, tree, headers):
    member = add_member(db, tree, "m2", first_name="Ada")
    with patch("app.api.routes.members.publish_workspace_event") as m:
        client.delete(
            f"{API}/workspaces/{tree.id}/members/{member.id}",
            headers=headers,
        )
    assert _content_event(_events(m), tree.id, "member")


def test_create_event_emits_content_changed(client, db, tree, headers):
    with patch("app.api.routes.events.publish_workspace_event") as m:
        res = client.post(
            f"{API}/workspaces/{tree.id}/events",
            json={"id": "ev1", "event_type": "birth", "date": "2000", "created_at": _TS},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _content_event(_events(m), tree.id, "event")


def test_create_story_emits_content_changed(client, db, tree, headers):
    with patch("app.api.routes.stories.publish_workspace_event") as m:
        res = client.post(
            f"{API}/workspaces/{tree.id}/stories",
            json={"id": "s1", "title": "A tale", "created_at": _TS, "updated_at": _TS},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _content_event(_events(m), tree.id, "story")


def test_create_document_emits_content_changed(client, db, tree, headers):
    with patch("app.api.routes.documents.publish_workspace_event") as m:
        res = client.post(
            f"{API}/workspaces/{tree.id}/documents",
            json={"title": "Census 1900"},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _content_event(_events(m), tree.id, "document")


_DOC = "data:text/plain;base64,aGVsbG8="  # "hello"


def test_add_document_file_emits_content_changed(client, db, tree, headers):
    created = client.post(
        f"{API}/workspaces/{tree.id}/documents",
        json={"title": "Census 1900"},
        headers=headers,
    )
    document_id = created.json()["id"]
    with patch("app.api.routes.documents.publish_workspace_event") as m:
        res = client.post(
            f"{API}/workspaces/{tree.id}/documents/{document_id}/files",
            data={"filename": "scan.txt"},
            files={"file": ("scan.txt", b"hello", "text/plain")},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _content_event(_events(m), tree.id, "document")
