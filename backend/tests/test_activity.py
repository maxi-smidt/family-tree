"""Tests for the activity-log feature (issue #125, extended for #564)."""

from sqlalchemy import select

from app.models.activity import ActivityLog
from app.services.merge import merge_trees
from tests.conftest import API, add_member, auth, befriend, make_tree, make_user, share

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _activity_rows(db, tree_id):
    return db.scalars(
        select(ActivityLog).where(ActivityLog.tree_id == tree_id)
    ).all()


MEMBER_PAYLOAD = {
    "id": "m1",
    "firstName": "Ada",
    "lastName": "Doe",
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
        json={"firstName": "Ada", "lastName": "Smith"},
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
        json={**MEMBER_PAYLOAD, "id": "m1", "firstName": "Ada"},
    )
    client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(owner),
        json={**MEMBER_PAYLOAD, "id": "m2", "firstName": "Bob"},
    )

    res = client.get(f"{API}/trees/{tree.id}/activity", headers=auth(owner))
    assert res.status_code == 200
    body = res.json()
    data = body["entries"]
    assert len(data) == 2
    assert body["total"] == 2
    # Newest first: second member added → first in list
    assert data[0]["created_at"] >= data[1]["created_at"]


def test_list_activity_paginates_by_offset(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    db.add_all(
        [
            ActivityLog(
                id=f"a{i}",
                tree_id=tree.id,
                action="create",
                target_type="member",
                created_at=f"2026-01-01T00:00:0{i}+00:00",
            )
            for i in range(1, 4)
        ]
    )
    db.commit()

    first = client.get(
        f"{API}/trees/{tree.id}/activity",
        headers=auth(owner),
        params={"limit": 2, "offset": 0},
    )
    assert first.status_code == 200
    first_body = first.json()
    assert [e["id"] for e in first_body["entries"]] == ["a3", "a2"]
    assert first_body["total"] == 3

    second = client.get(
        f"{API}/trees/{tree.id}/activity",
        headers=auth(owner),
        params={"limit": 2, "offset": 2},
    )
    assert second.status_code == 200
    second_body = second.json()
    assert [e["id"] for e in second_body["entries"]] == ["a1"]
    assert second_body["total"] == 3


def test_list_activity_filters_reduce_total(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    db.add_all(
        [
            ActivityLog(
                id="c1",
                tree_id=tree.id,
                actor_username="alice",
                action="create",
                target_type="member",
                created_at="2026-01-01T00:00:01+00:00",
            ),
            ActivityLog(
                id="u1",
                tree_id=tree.id,
                actor_username="bob",
                action="update",
                target_type="event",
                created_at="2026-01-01T00:00:02+00:00",
            ),
        ]
    )
    db.commit()

    res = client.get(
        f"{API}/trees/{tree.id}/activity",
        headers=auth(owner),
        params={"action": "update"},
    )
    assert res.status_code == 200
    body = res.json()
    assert [e["id"] for e in body["entries"]] == ["u1"]
    assert body["total"] == 1
    # actors reflects the whole tree, not just the filtered page
    assert body["actors"] == ["alice", "bob"]


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
    assert len(res.json()["entries"]) == 1


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
    assert len(res.json()["entries"]) == 1
    assert res.json()["entries"][0]["actor_username"] == "carol"


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
    row = res.json()["entries"][0]
    assert row["actor_id"] == owner.id
    assert row["actor_username"] == "alice"
    assert row["action"] == "create"
    assert row["target_type"] == "member"
    assert row["target_label"] == "Ada Doe"
    assert row["created_at"]


# ---------------------------------------------------------------------------
# Coverage added by #564: tree lifecycle, sharing, imports, merge, links
# ---------------------------------------------------------------------------

def test_create_tree_writes_activity(client, db):
    owner = make_user(db, "alice")

    res = client.post(
        f"{API}/trees", headers=auth(owner), json={"name": "New Tree"}
    )
    assert res.status_code == 201
    tree_id = res.json()["id"]

    rows = _activity_rows(db, tree_id)
    assert len(rows) == 1
    assert rows[0].action == "create"
    assert rows[0].target_type == "tree"
    assert rows[0].target_id == tree_id
    assert rows[0].target_label == "New Tree"


def test_rename_tree_writes_activity(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner, "Old Name")

    res = client.patch(
        f"{API}/trees/{tree.id}", headers=auth(owner), json={"name": "New Name"}
    )
    assert res.status_code == 200

    rows = _activity_rows(db, tree.id)
    assert len(rows) == 1
    assert rows[0].action == "update"
    assert rows[0].target_type == "tree"

    import json as _json
    details = _json.loads(rows[0].details)
    assert details["before"]["name"] == "Old Name"
    assert details["after"]["name"] == "New Name"


def test_rename_tree_no_op_does_not_write_activity(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner, "Same Name")

    res = client.patch(
        f"{API}/trees/{tree.id}", headers=auth(owner), json={"name": "Same Name"}
    )
    assert res.status_code == 200

    rows = _activity_rows(db, tree.id)
    assert len(rows) == 0


def test_share_tree_writes_activity(client, db):
    owner = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    res = client.post(
        f"{API}/trees/{tree.id}/access",
        headers=auth(owner),
        json={"username": "bob", "role": "viewer"},
    )
    assert res.status_code == 200

    rows = _activity_rows(db, tree.id)
    assert len(rows) == 1
    assert rows[0].action == "create"
    assert rows[0].target_type == "share"
    assert rows[0].target_id == bob.id
    assert rows[0].target_label == "bob"


def test_revoke_access_writes_activity(client, db):
    owner = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)
    share(db, tree, bob, role="viewer")

    res = client.delete(
        f"{API}/trees/{tree.id}/access/{bob.id}", headers=auth(owner)
    )
    assert res.status_code == 204

    rows = _activity_rows(db, tree.id)
    assert len(rows) == 1
    assert rows[0].action == "delete"
    assert rows[0].target_type == "share"
    assert rows[0].target_id == bob.id
    assert rows[0].target_label == "bob"


def test_merge_writes_activity_on_new_tree(db):
    owner = make_user(db, "alice")
    tree_a = make_tree(db, owner, "A")
    add_member(db, tree_a, "a1", first_name="Ada", last_name="Doe", gender="f")

    merged = merge_trees(db, owner, "Merged", tree_a.id, None)

    rows = _activity_rows(db, merged.id)
    assert len(rows) == 1
    assert rows[0].action == "create"
    assert rows[0].target_type == "merge"
    assert rows[0].target_id == merged.id
    assert rows[0].target_label == "Merged"
    # Nothing should be logged against the source tree.
    assert _activity_rows(db, tree_a.id) == []


def test_event_set_links_writes_activity(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada", last_name="Doe")

    created = client.post(
        f"{API}/trees/{tree.id}/events",
        headers=auth(owner),
        json={
            "id": "ev1",
            "event_type": "birth",
            "date": "2000",
            "created_at": "2000-01-01T00:00:00Z",
            "member_ids": [],
        },
    )
    assert created.status_code == 201
    event_id = created.json()["id"]

    res = client.put(
        f"{API}/trees/{tree.id}/events/{event_id}/links",
        headers=auth(owner),
        json={"member_ids": ["m1"]},
    )
    assert res.status_code == 204

    rows = _activity_rows(db, tree.id)
    # One row for the create, one for the links update.
    assert len(rows) == 2
    assert rows[-1].action == "update"
    assert rows[-1].target_type == "event"
    assert rows[-1].target_id == event_id


def test_story_set_links_writes_activity(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada", last_name="Doe")

    created = client.post(
        f"{API}/trees/{tree.id}/stories",
        headers=auth(owner),
        json={
            "id": "s1",
            "title": "A Story",
            "created_at": "2000-01-01T00:00:00Z",
            "updated_at": "2000-01-01T00:00:00Z",
            "member_ids": [],
        },
    )
    assert created.status_code == 201
    story_id = created.json()["id"]

    res = client.put(
        f"{API}/trees/{tree.id}/stories/{story_id}/links",
        headers=auth(owner),
        json={"member_ids": ["m1"]},
    )
    assert res.status_code == 204

    rows = _activity_rows(db, tree.id)
    assert len(rows) == 2
    assert rows[-1].action == "update"
    assert rows[-1].target_type == "story"
    assert rows[-1].target_id == story_id


def test_gallery_set_links_writes_activity(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada", last_name="Doe")

    created = client.post(
        f"{API}/trees/{tree.id}/gallery/images",
        headers=auth(owner),
        json={
            "id": "img1",
            "title": "A Photo",
            "uploaded_at": "2000-01-01T00:00:00Z",
            "member_ids": [],
        },
    )
    assert created.status_code == 201
    image_id = created.json()["id"]

    res = client.put(
        f"{API}/trees/{tree.id}/gallery/images/{image_id}/links",
        headers=auth(owner),
        json={"member_ids": ["m1"]},
    )
    assert res.status_code == 204

    rows = _activity_rows(db, tree.id)
    assert len(rows) == 2
    assert rows[-1].action == "update"
    assert rows[-1].target_type == "gallery_image"
    assert rows[-1].target_id == image_id


# Import (native bundle / GEDCOM) activity logging is exercised indirectly via
# _do_import / _do_import_gedcom's background-job plumbing (see
# tests/test_export_import.py for full import round-trips using
# wait_for_job). Adding a dedicated activity-log assertion here would mostly
# duplicate that machinery, so it is intentionally left to a follow-up if
# deeper coverage is wanted.
