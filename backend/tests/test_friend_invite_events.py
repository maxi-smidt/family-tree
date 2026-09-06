"""SSE events for friend requests and tree invitations (issue #412)."""

from unittest.mock import patch

from tests.conftest import API, auth, befriend, make_tree, make_user

# ---------------------------------------------------------------------------
# friend.request_received
# ---------------------------------------------------------------------------


def test_new_friend_request_emits_event(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")

    with patch("app.api.routes.friends.event_bus") as m:
        res = client.post(
            f"{API}/friends/requests",
            json={"username": "bob"},
            headers=auth(alice),
        )

    assert res.status_code == 201
    m.publish.assert_called_once_with(
        [bob.id],
        "friend.request_received",
        {"requester_id": alice.id, "requester_username": alice.username},
    )


def test_mutual_request_auto_accept_does_not_emit(client, db):
    """When a reverse-pending request is sent it resolves to accepted — no SSE."""
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    # Alice already sent a request, bob's request auto-accepts it.
    befriend(db, alice, bob, status="pending")

    with patch("app.api.routes.friends.event_bus") as m:
        res = client.post(
            f"{API}/friends/requests",
            json={"username": "alice"},
            headers=auth(bob),
        )

    assert res.status_code == 201
    assert res.json()["status"] == "accepted"
    m.publish.assert_not_called()


# ---------------------------------------------------------------------------
# invitation.received
# ---------------------------------------------------------------------------


def test_invitation_with_matching_email_emits_event(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")  # email is bob@example.com (set by make_user)
    tree = make_tree(db, alice)

    with patch("app.api.routes.invitations.event_bus") as m:
        res = client.post(
            f"{API}/workspaces/{tree.id}/invitations",
            json={"role": "viewer", "email": bob.email},
            headers=auth(alice),
        )

    assert res.status_code == 201
    m.publish.assert_called_once_with(
        [bob.id],
        "invitation.received",
        {"workspace_id": tree.id, "workspace_name": tree.name},
    )


def test_invitation_without_email_does_not_emit(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    with patch("app.api.routes.invitations.event_bus") as m:
        res = client.post(
            f"{API}/workspaces/{tree.id}/invitations",
            json={"role": "editor"},
            headers=auth(alice),
        )

    assert res.status_code == 201
    m.publish.assert_not_called()


def test_invitation_with_unknown_email_does_not_emit(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    with patch("app.api.routes.invitations.event_bus") as m:
        res = client.post(
            f"{API}/workspaces/{tree.id}/invitations",
            json={"role": "editor", "email": "nobody@example.com"},
            headers=auth(alice),
        )

    assert res.status_code == 201
    m.publish.assert_not_called()
