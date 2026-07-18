"""Live-collaboration presence: service unit tests + route/event tests."""

import asyncio
from unittest.mock import patch

import pytest

from app.services import feature_service, presence_service
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _clear_presence_store():
    """The in-process registry is a module global — isolate every test."""
    presence_service._store.clear()
    yield
    presence_service._store.clear()


# --- Service (in-process backend) ------------------------------------------


def test_touch_and_active_entries():
    async def _go():
        await presence_service.touch("t1", "u1", None)
        await presence_service.touch("t1", "u2", "m5")
        return await presence_service.active_entries("t1")

    entries = _run(_go())
    by_user = {e["user_id"]: e["editing_member_id"] for e in entries}
    assert by_user == {"u1": None, "u2": "m5"}


def test_leave_removes_entry():
    async def _go():
        await presence_service.touch("t1", "u1", None)
        await presence_service.touch("t1", "u2", None)
        await presence_service.leave("t1", "u1")
        return await presence_service.active_entries("t1")

    entries = _run(_go())
    assert [e["user_id"] for e in entries] == ["u2"]


def test_ttl_expiry(monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(presence_service, "_now", lambda: clock["now"])

    async def _go():
        await presence_service.touch("t1", "u1", None)
        # Advance past the TTL: the stale entry is pruned on the next read.
        clock["now"] += presence_service.PRESENCE_TTL_SECONDS + 1
        return await presence_service.active_entries("t1")

    assert _run(_go()) == []
    # Pruning also drops the now-empty tree bucket.
    assert "t1" not in presence_service._store


def test_touch_refreshes_last_seen(monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(presence_service, "_now", lambda: clock["now"])

    async def _go():
        await presence_service.touch("t1", "u1", None)
        clock["now"] += presence_service.PRESENCE_TTL_SECONDS - 1
        await presence_service.touch("t1", "u1", "m9")  # refresh before expiry
        clock["now"] += presence_service.PRESENCE_TTL_SECONDS - 1
        return await presence_service.active_entries("t1")

    entries = _run(_go())
    assert entries == [{"user_id": "u1", "editing_member_id": "m9"}]


# --- Route -----------------------------------------------------------------


@pytest.fixture()
def owner(db):
    return make_user(db, "owner")


@pytest.fixture()
def tree(db, owner):
    return make_tree(db, owner)


def test_heartbeat_returns_roster(client, tree, owner):
    res = client.post(
        f"{API}/trees/{tree.id}/presence", json={}, headers=auth(owner)
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["tree_id"] == tree.id
    assert [u["user_id"] for u in body["users"]] == [owner.id]
    assert body["users"][0]["display_name"] == "Owner"
    assert body["users"][0]["editing_member_id"] is None


def test_two_users_see_each_other(client, db, tree, owner):
    editor = make_user(db, "editor")
    share(db, tree, editor, role="editor")

    client.post(f"{API}/trees/{tree.id}/presence", json={}, headers=auth(owner))
    res = client.post(
        f"{API}/trees/{tree.id}/presence", json={}, headers=auth(editor)
    )
    assert res.status_code == 200, res.text
    ids = {u["user_id"] for u in res.json()["users"]}
    assert ids == {owner.id, editor.id}


def test_editing_member_id_reflected(client, db, tree, owner):
    add_member(db, tree, "m1", first_name="Ada")
    res = client.post(
        f"{API}/trees/{tree.id}/presence",
        json={"editing_member_id": "m1"},
        headers=auth(owner),
    )
    assert res.status_code == 200, res.text
    entry = next(u for u in res.json()["users"] if u["user_id"] == owner.id)
    assert entry["editing_member_id"] == "m1"


def test_leave_removes_from_roster(client, db, tree, owner):
    editor = make_user(db, "editor")
    share(db, tree, editor, role="viewer")

    client.post(f"{API}/trees/{tree.id}/presence", json={}, headers=auth(owner))
    client.post(f"{API}/trees/{tree.id}/presence", json={}, headers=auth(editor))

    res = client.delete(f"{API}/trees/{tree.id}/presence", headers=auth(owner))
    assert res.status_code == 204, res.text

    # A remaining member's next heartbeat no longer sees the owner.
    res = client.post(
        f"{API}/trees/{tree.id}/presence", json={}, headers=auth(editor)
    )
    ids = {u["user_id"] for u in res.json()["users"]}
    assert ids == {editor.id}


def test_presence_requires_read_access(client, db, tree, owner):
    stranger = make_user(db, "stranger")
    res = client.post(
        f"{API}/trees/{tree.id}/presence", json={}, headers=auth(stranger)
    )
    assert res.status_code == 403


def test_presence_requires_authentication(client, tree):
    res = client.post(f"{API}/trees/{tree.id}/presence", json={})
    assert res.status_code == 401


def test_presence_feature_off_returns_404(client, db, tree, owner):
    feature_service.set_state(db, "presence", "off")
    db.commit()
    res = client.post(
        f"{API}/trees/{tree.id}/presence", json={}, headers=auth(owner)
    )
    assert res.status_code == 404


def test_heartbeat_publishes_presence_updated(client, db, tree, owner):
    with patch("app.api.routes.presence.publish_tree_event") as m:
        client.post(f"{API}/trees/{tree.id}/presence", json={}, headers=auth(owner))
    published = [(c.args[2], c.args[3]) for c in m.call_args_list]
    assert any(
        et == "presence.updated"
        and d["tree_id"] == tree.id
        and [u["user_id"] for u in d["users"]] == [owner.id]
        for et, d in published
    )


def test_tree_mutation_publishes_the_actor_for_presence_highlighting(
    client, db, tree, owner
):
    with patch("app.services.event_bus.event_bus.publish") as publish:
        res = client.post(
            f"{API}/trees/{tree.id}/members",
            json={"id": "m1", "first_name": "Ada"},
            headers=auth(owner),
        )
    assert res.status_code == 201, res.text
    assert any(
        call.args[1] == "tree.content_changed"
        and call.args[2]
        == {
            "tree_id": tree.id,
            "domain": "member",
            "actor_user_id": owner.id,
        }
        for call in publish.call_args_list
    )
