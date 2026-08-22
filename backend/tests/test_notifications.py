"""Persistent notification inbox (issue #726): producers, listing, read state,
retention, and feature gating."""

from app.models import Notification
from app.schemas.notification import FriendRequestReceivedPayload
from app.services import notification_service
from app.services.system import feature_service
from tests.conftest import API, auth, befriend, make_tree, make_user, share

# ---------------------------------------------------------------------------
# Producers create a row (one per hook site)
# ---------------------------------------------------------------------------


def test_friend_request_received_notification(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")

    res = client.post(
        f"{API}/friends/requests", json={"username": "bob"}, headers=auth(alice)
    )
    assert res.status_code == 201

    res = client.get(f"{API}/notifications", headers=auth(bob))
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["unread_count"] == 1
    assert body["entries"][0]["type"] == "friend_request_received"
    assert body["entries"][0]["payload"] == {
        "requester_id": alice.id,
        "requester_username": "alice",
    }
    assert body["entries"][0]["read_at"] is None


def test_friend_request_accepted_notifies_original_requester(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, alice, bob, status="pending")  # alice requested, bob is addressee

    # The URL param is the *other* party in the friendship, not the caller.
    res = client.post(f"{API}/friends/{alice.id}/accept", headers=auth(bob))
    assert res.status_code == 200

    res = client.get(f"{API}/notifications", headers=auth(alice))
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["entries"][0]["type"] == "friend_request_accepted"
    assert body["entries"][0]["payload"] == {
        "addressee_id": bob.id,
        "addressee_username": "bob",
    }


def test_invitation_received_notification(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")  # email is bob@example.com (set by make_user)
    tree = make_tree(db, alice)

    res = client.post(
        f"{API}/trees/{tree.id}/invitations",
        json={"role": "viewer", "email": bob.email},
        headers=auth(alice),
    )
    assert res.status_code == 201

    res = client.get(f"{API}/notifications", headers=auth(bob))
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["entries"][0]["type"] == "invitation_received"
    assert body["entries"][0]["payload"] == {
        "tree_id": tree.id,
        "tree_name": tree.name,
    }


def test_tree_shared_notification_on_new_grant_only(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, alice, bob, status="accepted")
    tree = make_tree(db, alice)

    res = client.post(
        f"{API}/trees/{tree.id}/access",
        json={"username": "bob", "role": "viewer"},
        headers=auth(alice),
    )
    assert res.status_code == 200

    res = client.get(f"{API}/notifications", headers=auth(bob))
    body = res.json()
    assert body["total"] == 1
    assert body["entries"][0]["type"] == "tree_shared"
    assert body["entries"][0]["payload"] == {
        "tree_id": tree.id,
        "tree_name": tree.name,
        "role": "viewer",
        "actor_username": "alice",
    }

    # Re-sharing (role change on an existing membership) is not a new grant,
    # so it must not create a second notification.
    res = client.post(
        f"{API}/trees/{tree.id}/access",
        json={"username": "bob", "role": "editor"},
        headers=auth(alice),
    )
    assert res.status_code == 200
    body = client.get(f"{API}/notifications", headers=auth(bob)).json()
    assert body["total"] == 1


def test_tree_unshared_notification(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    share(db, tree, bob, role="viewer")

    res = client.delete(f"{API}/trees/{tree.id}/access/{bob.id}", headers=auth(alice))
    assert res.status_code == 204

    body = client.get(f"{API}/notifications", headers=auth(bob)).json()
    assert body["total"] == 1
    assert body["entries"][0]["type"] == "tree_unshared"
    assert body["entries"][0]["payload"] == {
        "tree_id": tree.id,
        "tree_name": tree.name,
    }


def test_batch_share_and_revoke_notify_per_tree(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, alice, bob, status="accepted")
    tree_a = make_tree(db, alice, name="Tree A")
    tree_b = make_tree(db, alice, name="Tree B")

    res = client.post(
        f"{API}/trees/{tree_a.id}/access/batch",
        json={
            "username": "bob",
            "role": "viewer",
            "tree_ids": [tree_a.id, tree_b.id],
        },
        headers=auth(alice),
    )
    assert res.status_code == 200

    body = client.get(f"{API}/notifications", headers=auth(bob)).json()
    assert body["total"] == 2
    types_and_trees = {(e["type"], e["payload"]["tree_id"]) for e in body["entries"]}
    assert types_and_trees == {
        ("tree_shared", tree_a.id),
        ("tree_shared", tree_b.id),
    }

    res = client.post(
        f"{API}/trees/{tree_a.id}/access/batch-revoke",
        json={"user_id": bob.id, "tree_ids": [tree_a.id, tree_b.id]},
        headers=auth(alice),
    )
    assert res.status_code == 204

    body = client.get(f"{API}/notifications", headers=auth(bob)).json()
    assert body["total"] == 4
    unshared_trees = {
        e["payload"]["tree_id"] for e in body["entries"] if e["type"] == "tree_unshared"
    }
    assert unshared_trees == {tree_a.id, tree_b.id}


# ---------------------------------------------------------------------------
# Listing: pagination + unread_count + total
# ---------------------------------------------------------------------------


def test_list_pagination_and_counts(client, db):
    bob = make_user(db, "bob")
    for name in ("alice", "carol", "dave"):
        make_user(db, name)
        notification_service.create_notification(
            db, bob.id, "friend_request_received",
            FriendRequestReceivedPayload(requester_id="x", requester_username=name),
        )

    res = client.get(f"{API}/notifications", headers=auth(bob), params={"limit": 2})
    body = res.json()
    assert body["total"] == 3
    assert body["unread_count"] == 3
    assert len(body["entries"]) == 2
    # newest first
    assert body["entries"][0]["payload"]["requester_username"] == "dave"

    res = client.get(
        f"{API}/notifications",
        headers=auth(bob),
        params={"limit": 2, "offset": 2},
    )
    body = res.json()
    assert len(body["entries"]) == 1
    assert body["entries"][0]["payload"]["requester_username"] == "alice"

    res = client.get(f"{API}/notifications/unread-count", headers=auth(bob))
    assert res.status_code == 200
    assert res.json() == {"unread_count": 3}


# ---------------------------------------------------------------------------
# Mark read / mark all read
# ---------------------------------------------------------------------------


def test_mark_read_marks_one_and_404_for_other_user(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    notification_service.create_notification(
        db, bob.id, "friend_request_received",
        FriendRequestReceivedPayload(
            requester_id=alice.id, requester_username="alice"
        ),
    )
    notif_id = client.get(f"{API}/notifications", headers=auth(bob)).json()[
        "entries"
    ][0]["id"]

    # Another user cannot mark someone else's notification read.
    res = client.post(f"{API}/notifications/{notif_id}/read", headers=auth(alice))
    assert res.status_code == 404

    res = client.post(f"{API}/notifications/{notif_id}/read", headers=auth(bob))
    assert res.status_code == 204

    body = client.get(f"{API}/notifications", headers=auth(bob)).json()
    assert body["unread_count"] == 0
    assert body["entries"][0]["read_at"] is not None

    # Idempotent: marking an already-read notification read again still 204s.
    res = client.post(f"{API}/notifications/{notif_id}/read", headers=auth(bob))
    assert res.status_code == 204


def test_mark_all_read_clears_unread(client, db):
    bob = make_user(db, "bob")
    for name in ("alice", "carol"):
        notification_service.create_notification(
            db, bob.id, "friend_request_received",
            FriendRequestReceivedPayload(requester_id="x", requester_username=name),
        )

    res = client.post(f"{API}/notifications/read-all", headers=auth(bob))
    assert res.status_code == 204

    body = client.get(f"{API}/notifications", headers=auth(bob)).json()
    assert body["unread_count"] == 0
    assert all(e["read_at"] is not None for e in body["entries"])


# ---------------------------------------------------------------------------
# Retention: keep-last-100 per user, enforced at insert time
# ---------------------------------------------------------------------------


def test_retention_caps_at_100_per_user(db):
    alice = make_user(db, "alice")
    for i in range(105):
        notification_service.create_notification(
            db, alice.id, "friend_request_received",
            FriendRequestReceivedPayload(requester_id="x", requester_username=f"u{i}"),
        )
    count = (
        db.query(Notification).filter(Notification.user_id == alice.id).count()
    )
    assert count == 100


# ---------------------------------------------------------------------------
# Feature gating: "off" hides the routes AND stops the producer from writing
# ---------------------------------------------------------------------------


def test_disabled_feature_hides_routes_and_producer_writes_nothing(client, db):
    alice = make_user(db, "alice")
    feature_service.set_state(db, "notifications", "off")
    db.commit()

    res = client.get(f"{API}/notifications", headers=auth(alice))
    assert res.status_code == 404
    res = client.get(f"{API}/notifications/unread-count", headers=auth(alice))
    assert res.status_code == 404
    res = client.post(f"{API}/notifications/read-all", headers=auth(alice))
    assert res.status_code == 404

    notification_service.create_notification(
        db, alice.id, "friend_request_received",
        FriendRequestReceivedPayload(requester_id="x", requester_username="x"),
    )
    count = (
        db.query(Notification).filter(Notification.user_id == alice.id).count()
    )
    assert count == 0
