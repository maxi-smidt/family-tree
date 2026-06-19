"""Tests for the activity-log feature (issue #125)."""

from sqlalchemy import select

from app.models.activity import ActivityLog
from tests.conftest import API, add_member, auth, make_tree, make_user, share

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _activity_rows(db, tree_id):
    return db.scalars(
        select(ActivityLog).where(ActivityLog.tree_id == tree_id)
    ).all()


MEMBER_PAYLOAD = {
    "id": "m1",
    "first_name": "Ada",
    "last_name": "Doe",
    "gender": "f",
}


# ---------------------------------------------------------------------------
# Create / update / delete member → writes activity row
# ---------------------------------------------------------------------------

def test_create_member_writes_activity(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)

    res = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(owner),
        json=MEMBER_PAYLOAD,
    )
    assert res.status_code == 201

    rows = _activity_rows(db, tree.id)
    assert len(rows) == 1
    row = rows[0]
    assert row.actor_id == owner.id
    assert row.actor_username == owner.username
    assert row.action == "create"
    assert row.target_type == "member"
    assert row.target_id == "m1"
    assert row.target_label == "Ada Doe"


def test_update_member_writes_activity(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada", last_name="Doe")

    res = client.patch(
        f"{API}/trees/{tree.id}/members/m1",
        headers=auth(owner),
        json={"first_name": "Ada", "last_name": "Smith"},
    )
    assert res.status_code == 200

    rows = _activity_rows(db, tree.id)
    assert len(rows) == 1
    assert rows[0].action == "update"
    assert rows[0].target_type == "member"


def test_delete_member_writes_activity(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada", last_name="Doe")

    res = client.delete(
        f"{API}/trees/{tree.id}/members/m1",
        headers=auth(owner),
    )
    assert res.status_code == 204

    rows = _activity_rows(db, tree.id)
    assert len(rows) == 1
    assert rows[0].action == "delete"
    assert rows[0].target_type == "member"
    assert rows[0].target_label == "Ada Doe"


# ---------------------------------------------------------------------------
# GET /activity endpoint: ordering and access control
# ---------------------------------------------------------------------------

def test_list_activity_returns_newest_first(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)

    # Create two members → two rows
    client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(owner),
        json={**MEMBER_PAYLOAD, "id": "m1", "first_name": "Ada"},
    )
    client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(owner),
        json={**MEMBER_PAYLOAD, "id": "m2", "first_name": "Bob"},
    )

    res = client.get(f"{API}/trees/{tree.id}/activity", headers=auth(owner))
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 2
    # Newest first: second member added → first in list
    assert data[0]["created_at"] >= data[1]["created_at"]


def test_viewer_can_read_activity(client, db):
    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, viewer, role="viewer")

    client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(owner),
        json=MEMBER_PAYLOAD,
    )

    res = client.get(f"{API}/trees/{tree.id}/activity", headers=auth(viewer))
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_editor_can_read_activity(client, db):
    owner = make_user(db, "alice")
    editor = make_user(db, "carol")
    tree = make_tree(db, owner)
    share(db, tree, editor, role="editor")

    client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(editor),
        json=MEMBER_PAYLOAD,
    )

    res = client.get(f"{API}/trees/{tree.id}/activity", headers=auth(editor))
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["actor_username"] == "carol"


def test_unauthorized_cannot_read_activity(client, db):
    owner = make_user(db, "alice")
    outsider = make_user(db, "eve")
    tree = make_tree(db, owner)

    res = client.get(f"{API}/trees/{tree.id}/activity", headers=auth(outsider))
    assert res.status_code in (403, 404)


def test_denied_write_does_not_write_activity(client, db):
    """A viewer attempting a write must not produce any activity row."""
    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, viewer, role="viewer")

    res = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(viewer),
        json=MEMBER_PAYLOAD,
    )
    assert res.status_code == 403

    rows = _activity_rows(db, tree.id)
    assert len(rows) == 0


# ---------------------------------------------------------------------------
# Actor snapshot stored correctly
# ---------------------------------------------------------------------------

def test_activity_stores_actor_snapshot(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)

    client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(owner),
        json=MEMBER_PAYLOAD,
    )

    res = client.get(f"{API}/trees/{tree.id}/activity", headers=auth(owner))
    row = res.json()[0]
    assert row["actor_id"] == owner.id
    assert row["actor_username"] == "alice"
    assert row["action"] == "create"
    assert row["target_type"] == "member"
    assert row["target_label"] == "Ada Doe"
    assert row["created_at"]
