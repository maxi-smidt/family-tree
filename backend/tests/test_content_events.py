"""Tests that content mutations emit tree.content_changed SSE events."""

from unittest.mock import patch

import pytest

from tests.conftest import API, add_member, auth, make_tree, make_user

_TS = "2000-01-01T00:00:00Z"


@pytest.fixture()
def owner(db):
    return make_user(db, "owner")


@pytest.fixture()
def tree(db, owner):
    return make_tree(db, owner)


@pytest.fixture()
def headers(owner):
    return auth(owner)


def _events(mock):
    """Return list of (event_type, data) from publish_tree_event mock calls."""
    return [(c.args[2], c.args[3]) for c in mock.call_args_list]


def _content_event(events, tree_id, domain):
    return any(
        et == "tree.content_changed" and d == {"tree_id": tree_id, "domain": domain}
        for et, d in events
    )


def test_create_member_emits_content_changed(client, db, tree, headers):
    with patch("app.api.routes.members.publish_tree_event") as m:
        client.post(
            f"{API}/trees/{tree.id}/members",
            json={"id": "m-new", "first_name": "Ada"},
            headers=headers,
        )
    assert _content_event(_events(m), tree.id, "member")


def test_update_member_emits_content_changed(client, db, tree, headers):
    member = add_member(db, tree, "m1", first_name="Ada")
    with patch("app.api.routes.members.publish_tree_event") as m:
        client.patch(
            f"{API}/trees/{tree.id}/members/{member.id}",
            json={"first_name": "Eve"},
            headers=headers,
        )
    assert _content_event(_events(m), tree.id, "member")


def test_delete_member_emits_content_changed(client, db, tree, headers):
    member = add_member(db, tree, "m2", first_name="Ada")
    with patch("app.api.routes.members.publish_tree_event") as m:
        client.delete(
            f"{API}/trees/{tree.id}/members/{member.id}",
            headers=headers,
        )
    assert _content_event(_events(m), tree.id, "member")


def test_create_event_emits_content_changed(client, db, tree, headers):
    with patch("app.api.routes.events.publish_tree_event") as m:
        res = client.post(
            f"{API}/trees/{tree.id}/events",
            json={"id": "ev1", "event_type": "birth", "date": "2000", "created_at": _TS},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _content_event(_events(m), tree.id, "event")


def test_create_story_emits_content_changed(client, db, tree, headers):
    with patch("app.api.routes.stories.publish_tree_event") as m:
        res = client.post(
            f"{API}/trees/{tree.id}/stories",
            json={"id": "s1", "title": "A tale", "created_at": _TS, "updated_at": _TS},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _content_event(_events(m), tree.id, "story")


def test_create_source_emits_content_changed(client, db, tree, headers):
    with patch("app.api.routes.sources.publish_tree_event") as m:
        res = client.post(
            f"{API}/trees/{tree.id}/sources",
            json={
                "id": "src1", "title": "Census 1900",
                "created_at": _TS, "updated_at": _TS,
            },
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _content_event(_events(m), tree.id, "source")


_DOC = "data:text/plain;base64,aGVsbG8="  # "hello"


def test_add_story_attachment_emits_content_changed(client, db, tree, headers):
    client.post(
        f"{API}/trees/{tree.id}/stories",
        json={"id": "s1", "title": "A tale", "created_at": _TS, "updated_at": _TS},
        headers=headers,
    )
    with patch("app.api.routes.stories.publish_tree_event") as m:
        res = client.post(
            f"{API}/trees/{tree.id}/stories/s1/attachments",
            json={"filename": "note.txt", "data": _DOC},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _content_event(_events(m), tree.id, "story")


def test_add_event_attachment_emits_content_changed(client, db, tree, headers):
    client.post(
        f"{API}/trees/{tree.id}/events",
        json={"id": "ev1", "event_type": "birth", "date": "2000", "created_at": _TS},
        headers=headers,
    )
    with patch("app.api.routes.events.publish_tree_event") as m:
        res = client.post(
            f"{API}/trees/{tree.id}/events/ev1/attachments",
            json={"filename": "note.txt", "data": _DOC},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _content_event(_events(m), tree.id, "event")


def test_add_source_evidence_emits_content_changed(client, db, tree, headers):
    client.post(
        f"{API}/trees/{tree.id}/sources",
        json={
            "id": "src1", "title": "Census 1900",
            "created_at": _TS, "updated_at": _TS,
        },
        headers=headers,
    )
    with patch("app.api.routes.sources.publish_tree_event") as m:
        res = client.post(
            f"{API}/trees/{tree.id}/sources/src1/evidence",
            json={"kind": "file", "filename": "scan.txt", "data": _DOC},
            headers=headers,
        )
        assert res.status_code == 201, res.text
    assert _content_event(_events(m), tree.id, "source")
