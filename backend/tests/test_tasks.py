"""Tests for research tasks (issue #725): CRUD, scoping, roles, flag, activity."""

from sqlalchemy import select

from app.models.activity import ActivityLog
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _setup(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="A")
    return user, tree


def _create_task(client, user, tree, task_id="t1", member_id="m1", **overrides):
    payload = {
        "id": task_id,
        "member_id": member_id,
        "title": "Find birth record",
        "notes": None,
        "created_at": "2026-01-01T00:00:00Z",
        **overrides,
    }
    return client.post(
        f"{API}/trees/{tree.id}/tasks", headers=auth(user), json=payload
    )


def test_create_and_list_task(client, db):
    user, tree = _setup(client, db)
    res = _create_task(client, user, tree)
    assert res.status_code == 201
    body = res.json()
    assert body["member_id"] == "m1"
    assert body["done"] is False
    assert body["done_at"] is None

    tasks = client.get(f"{API}/trees/{tree.id}/tasks", headers=auth(user)).json()
    assert [t["id"] for t in tasks] == ["t1"]


def test_create_tree_level_task_without_member(client, db):
    user, tree = _setup(client, db)
    res = _create_task(client, user, tree, task_id="t2", member_id=None)
    assert res.status_code == 201
    assert res.json()["member_id"] is None


def test_create_task_rejects_member_from_other_tree(client, db):
    user, tree = _setup(client, db)
    other = make_tree(db, user, "Other")
    add_member(db, other, "foreign")
    res = _create_task(client, user, tree, member_id="foreign")
    assert res.status_code == 404


def test_complete_and_reopen_task(client, db):
    user, tree = _setup(client, db)
    _create_task(client, user, tree)

    res = client.patch(
        f"{API}/trees/{tree.id}/tasks/t1",
        headers=auth(user),
        json={
            "title": "Find birth record",
            "notes": "checked parish archive",
            "done": True,
            "done_at": "2026-02-01T00:00:00Z",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["done"] is True
    assert body["done_at"] == "2026-02-01T00:00:00Z"

    # Reopening clears done_at even if the client still sends one.
    res = client.patch(
        f"{API}/trees/{tree.id}/tasks/t1",
        headers=auth(user),
        json={
            "title": "Find birth record",
            "notes": None,
            "done": False,
            "done_at": "2026-02-01T00:00:00Z",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["done"] is False
    assert body["done_at"] is None


def test_delete_task(client, db):
    user, tree = _setup(client, db)
    _create_task(client, user, tree)
    res = client.delete(f"{API}/trees/{tree.id}/tasks/t1", headers=auth(user))
    assert res.status_code == 204
    tasks = client.get(f"{API}/trees/{tree.id}/tasks", headers=auth(user)).json()
    assert tasks == []


def test_tasks_scoped_to_tree(client, db):
    user, tree = _setup(client, db)
    other = make_tree(db, user, "Other")
    _create_task(client, user, tree)

    assert (
        client.get(f"{API}/trees/{other.id}/tasks", headers=auth(user)).json() == []
    )
    # Cross-tree access to the task id 404s.
    res = client.patch(
        f"{API}/trees/{other.id}/tasks/t1",
        headers=auth(user),
        json={"title": "x", "notes": None, "done": False, "done_at": None},
    )
    assert res.status_code == 404
    assert (
        client.delete(f"{API}/trees/{other.id}/tasks/t1", headers=auth(user)).status_code
        == 404
    )


def test_viewer_reads_but_cannot_write(client, db):
    user, tree = _setup(client, db)
    viewer = make_user(db, "bob")
    share(db, tree, viewer, role="viewer")
    _create_task(client, user, tree)

    res = client.get(f"{API}/trees/{tree.id}/tasks", headers=auth(viewer))
    assert res.status_code == 200
    assert len(res.json()) == 1

    assert _create_task(client, viewer, tree, task_id="t2").status_code == 403
    res = client.patch(
        f"{API}/trees/{tree.id}/tasks/t1",
        headers=auth(viewer),
        json={"title": "x", "notes": None, "done": True, "done_at": "2026"},
    )
    assert res.status_code == 403
    assert (
        client.delete(f"{API}/trees/{tree.id}/tasks/t1", headers=auth(viewer)).status_code
        == 403
    )


def test_editor_can_write(client, db):
    user, tree = _setup(client, db)
    editor = make_user(db, "carol")
    share(db, tree, editor, role="editor")
    assert _create_task(client, editor, tree).status_code == 201


def test_disabled_flag_hides_routes(client, db):
    admin = make_user(db, "root", is_admin=True)
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1")

    res = client.patch(
        f"{API}/admin/features/research_tasks",
        headers=auth(admin),
        json={"state": "off"},
    )
    assert res.status_code == 200

    assert (
        client.get(f"{API}/trees/{tree.id}/tasks", headers=auth(user)).status_code
        == 404
    )
    assert _create_task(client, user, tree).status_code == 404


def test_task_changes_write_activity(client, db):
    user, tree = _setup(client, db)
    _create_task(client, user, tree)
    client.patch(
        f"{API}/trees/{tree.id}/tasks/t1",
        headers=auth(user),
        json={"title": "Find birth record", "notes": None, "done": True,
              "done_at": "2026-02-01T00:00:00Z"},
    )
    client.delete(f"{API}/trees/{tree.id}/tasks/t1", headers=auth(user))

    rows = db.scalars(
        select(ActivityLog).where(
            ActivityLog.tree_id == tree.id, ActivityLog.target_type == "task"
        )
    ).all()
    assert [r.action for r in rows] == ["create", "update", "delete"]
    assert all(r.target_id == "t1" for r in rows)
    assert all(r.target_label == "Find birth record" for r in rows)
