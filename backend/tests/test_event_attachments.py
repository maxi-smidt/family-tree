"""Tests for direct document/image uploads on events (mirrors story attachments)."""

import pytest

from tests.conftest import API, auth, make_tree, make_user

_TS = "2000-01-01T00:00:00Z"
_DOC = "data:text/plain;base64,aGVsbG8="  # "hello"


@pytest.fixture()
def owner(db):
    return make_user(db, "owner")


@pytest.fixture()
def tree(db, owner):
    return make_tree(db, owner)


@pytest.fixture()
def headers(owner):
    return auth(owner)


def _create_event(client, tree, headers, event_id="ev1"):
    res = client.post(
        f"{API}/trees/{tree.id}/events",
        json={
            "id": event_id,
            "event_type": "birth",
            "date": "2000",
            "created_at": _TS,
        },
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_add_attachment_appears_in_event_list(client, db, tree, headers):
    _create_event(client, tree, headers)

    res = client.post(
        f"{API}/trees/{tree.id}/events/ev1/attachments",
        json={"filename": "note.txt", "data": _DOC},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["filename"] == "note.txt"
    assert body["mime_type"] == "text/plain"
    assert body["size"] == 5
    assert body["url"].startswith("/api/media/")

    listed = client.get(f"{API}/trees/{tree.id}/events", headers=headers)
    assert listed.status_code == 200, listed.text
    events = listed.json()
    assert len(events) == 1
    assert len(events[0]["attachments"]) == 1
    assert events[0]["attachments"][0]["filename"] == "note.txt"


def test_rename_attachment(client, db, tree, headers):
    _create_event(client, tree, headers)
    add = client.post(
        f"{API}/trees/{tree.id}/events/ev1/attachments",
        json={"filename": "note.txt", "data": _DOC},
        headers=headers,
    )
    attachment_id = add.json()["id"]

    res = client.patch(
        f"{API}/trees/{tree.id}/events/ev1/attachments/{attachment_id}",
        json={"filename": "renamed.txt"},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["filename"] == "renamed.txt"

    listed = client.get(f"{API}/trees/{tree.id}/events", headers=headers)
    assert listed.json()[0]["attachments"][0]["filename"] == "renamed.txt"


def test_delete_attachment(client, db, tree, headers):
    _create_event(client, tree, headers)
    add = client.post(
        f"{API}/trees/{tree.id}/events/ev1/attachments",
        json={"filename": "note.txt", "data": _DOC},
        headers=headers,
    )
    attachment_id = add.json()["id"]

    res = client.delete(
        f"{API}/trees/{tree.id}/events/ev1/attachments/{attachment_id}",
        headers=headers,
    )
    assert res.status_code == 204, res.text

    listed = client.get(f"{API}/trees/{tree.id}/events", headers=headers)
    assert listed.json()[0]["attachments"] == []


def test_delete_event_cascades_attachments(client, db, tree, headers):
    from app.models import EventAttachment

    _create_event(client, tree, headers)
    add = client.post(
        f"{API}/trees/{tree.id}/events/ev1/attachments",
        json={"filename": "note.txt", "data": _DOC},
        headers=headers,
    )
    attachment_id = add.json()["id"]
    assert db.get(EventAttachment, attachment_id) is not None

    res = client.delete(f"{API}/trees/{tree.id}/events/ev1", headers=headers)
    assert res.status_code == 204, res.text

    assert db.get(EventAttachment, attachment_id) is None
