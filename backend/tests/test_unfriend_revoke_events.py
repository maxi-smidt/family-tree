"""Unfriend/block revokes shared tree access with realtime + inbox notice.

Issues #813/#814: ``revoke_shared_memberships`` used to silently delete the
membership rows, so the revoked user's open session never learned about it.
The routes now mirror the explicit unshare route: a ``tree.access_changed``
SSE event reaching the revoked user, plus a durable ``tree_unshared``
notification.
"""

from unittest.mock import patch

from sqlalchemy import select

from app.models import Notification, TreeMembership
from tests.conftest import API, auth, befriend, make_tree, make_user, share


def _access_changed_calls(m) -> list[tuple[set[str], dict]]:
    return [
        (set(call.args[0]), call.args[2])
        for call in m.call_args_list
        if call.args[1] == "tree.access_changed"
    ]


def _unshared_notifications(db, user_id: str) -> list[Notification]:
    return list(
        db.scalars(
            select(Notification).where(
                Notification.user_id == user_id,
                Notification.type == "tree_unshared",
            )
        ).all()
    )


def test_unfriend_emits_access_changed_and_notification(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, alice, bob)
    tree = make_tree(db, alice)
    share(db, tree, bob)

    with patch("app.services.event_bus.event_bus.publish") as m:
        res = client.delete(f"{API}/friends/{bob.id}", headers=auth(alice))

    assert res.status_code == 204
    # Membership is gone.
    assert db.get(TreeMembership, (tree.id, bob.id)) is None
    # SSE event reaches the revoked user (audience no longer includes them,
    # so they must come through extra_user_ids).
    calls = _access_changed_calls(m)
    assert len(calls) == 1
    audience, data = calls[0]
    assert data == {"tree_id": tree.id}
    assert {alice.id, bob.id} <= audience
    # Durable inbox notification for the revoked user.
    entries = _unshared_notifications(db, bob.id)
    assert len(entries) == 1


def test_unfriend_revokes_both_directions(client, db):
    """Each user loses the trees the other one owns and shared with them."""
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, alice, bob)
    alices_tree = make_tree(db, alice, name="Alice's tree")
    bobs_tree = make_tree(db, bob, name="Bob's tree")
    share(db, alices_tree, bob)
    share(db, bobs_tree, alice)

    with patch("app.services.event_bus.event_bus.publish") as m:
        res = client.delete(f"{API}/friends/{bob.id}", headers=auth(alice))

    assert res.status_code == 204
    assert db.get(TreeMembership, (alices_tree.id, bob.id)) is None
    assert db.get(TreeMembership, (bobs_tree.id, alice.id)) is None

    calls = _access_changed_calls(m)
    assert len(calls) == 2
    by_tree = {data["tree_id"]: audience for audience, data in calls}
    assert bob.id in by_tree[alices_tree.id]
    assert alice.id in by_tree[bobs_tree.id]

    assert len(_unshared_notifications(db, bob.id)) == 1
    assert len(_unshared_notifications(db, alice.id)) == 1


def test_cancel_pending_request_emits_nothing(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, alice, bob, status="pending")

    with patch("app.services.event_bus.event_bus.publish") as m:
        res = client.delete(f"{API}/friends/{bob.id}", headers=auth(alice))

    assert res.status_code == 204
    assert _access_changed_calls(m) == []
    assert _unshared_notifications(db, bob.id) == []


def test_block_emits_access_changed_and_notification(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, alice, bob)
    tree = make_tree(db, alice)
    share(db, tree, bob)

    with patch("app.services.event_bus.event_bus.publish") as m:
        res = client.post(f"{API}/friends/{bob.id}/block", headers=auth(alice))

    assert res.status_code == 204
    assert db.get(TreeMembership, (tree.id, bob.id)) is None
    calls = _access_changed_calls(m)
    assert len(calls) == 1
    audience, data = calls[0]
    assert data == {"tree_id": tree.id}
    assert bob.id in audience
    assert len(_unshared_notifications(db, bob.id)) == 1
