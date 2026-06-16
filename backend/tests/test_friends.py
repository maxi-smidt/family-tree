"""Friend requests, the accepted-friends graph and its share side-effects."""

from app.models import TreeMembership
from tests.conftest import API, auth, befriend, make_tree, make_user, share


def _send(client, sender, username):
    return client.post(
        f"{API}/friends/requests", headers=auth(sender), json={"username": username}
    )


def test_send_accept_flow(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")

    sent = _send(client, alice, "bob")
    assert sent.status_code == 201
    assert sent.json()["status"] == "pending"
    assert sent.json()["direction"] == "outgoing"

    # Bob sees it as incoming, alice as outgoing.
    incoming = client.get(f"{API}/friends/incoming", headers=auth(bob)).json()
    assert [f["user_id"] for f in incoming] == [alice.id]
    outgoing = client.get(f"{API}/friends/outgoing", headers=auth(alice)).json()
    assert [f["user_id"] for f in outgoing] == [bob.id]

    accepted = client.post(f"{API}/friends/{alice.id}/accept", headers=auth(bob))
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"

    alice_friends = client.get(f"{API}/friends", headers=auth(alice)).json()
    bob_friends = client.get(f"{API}/friends", headers=auth(bob)).json()
    assert [f["user_id"] for f in alice_friends] == [bob.id]
    assert [f["user_id"] for f in bob_friends] == [alice.id]


def test_decline_request(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    _send(client, alice, "bob")

    declined = client.post(f"{API}/friends/{alice.id}/decline", headers=auth(bob))
    assert declined.status_code == 204
    assert client.get(f"{API}/friends/incoming", headers=auth(bob)).json() == []
    assert client.get(f"{API}/friends", headers=auth(alice)).json() == []


def test_mutual_request_auto_accepts(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    _send(client, alice, "bob")

    # Bob independently asks Alice — the pending request resolves to accepted.
    res = _send(client, bob, "alice")
    assert res.status_code == 201
    assert res.json()["status"] == "accepted"
    bob_friends = client.get(f"{API}/friends", headers=auth(bob)).json()
    assert [f["user_id"] for f in bob_friends] == [alice.id]


def test_re_request_after_decline(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    _send(client, alice, "bob")
    client.post(f"{API}/friends/{alice.id}/decline", headers=auth(bob))

    again = _send(client, alice, "bob")
    assert again.status_code == 201
    assert again.json()["status"] == "pending"
    incoming = client.get(f"{API}/friends/incoming", headers=auth(bob)).json()
    assert [f["user_id"] for f in incoming] == [alice.id]


def test_cancel_outgoing_request(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    _send(client, alice, "bob")

    cancelled = client.delete(f"{API}/friends/{bob.id}", headers=auth(alice))
    assert cancelled.status_code == 204
    assert client.get(f"{API}/friends/incoming", headers=auth(bob)).json() == []


def test_cannot_friend_self(client, db):
    alice = make_user(db, "alice")
    assert _send(client, alice, "alice").status_code == 400


def test_send_to_unknown_user(client, db):
    alice = make_user(db, "alice")
    assert _send(client, alice, "ghost").status_code == 404


def test_accept_requires_being_addressee(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    _send(client, alice, "bob")
    # Alice (the requester) cannot accept her own outgoing request.
    res = client.post(f"{API}/friends/{bob.id}/accept", headers=auth(alice))
    assert res.status_code == 400


def test_search_excludes_self_and_annotates_status(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, alice, bob)
    make_user(db, "alicia")  # also matches "ali"

    res = client.get(f"{API}/friends/search?q=ali", headers=auth(alice))
    assert res.status_code == 200
    by_name = {r["username"]: r for r in res.json()}
    assert "alice" not in by_name  # never includes the caller
    assert "alicia" in by_name and by_name["alicia"]["status"] is None

    bob_hit = client.get(f"{API}/friends/search?q=bob", headers=auth(alice)).json()
    assert bob_hit[0]["status"] == "accepted"
    assert "email" not in bob_hit[0]  # privacy: emails never exposed


def test_search_annotates_pending_direction(client, db):
    alice = make_user(db, "alice")
    make_user(db, "bob")
    _send(client, alice, "bob")

    # Alice sent the request → from her side it's an outgoing pending.
    hit = client.get(f"{API}/friends/search?q=bob", headers=auth(alice)).json()[0]
    assert hit["status"] == "pending"
    assert hit["direction"] == "outgoing"


def test_search_empty_query_returns_nothing(client, db):
    alice = make_user(db, "alice")
    make_user(db, "bob")
    assert client.get(f"{API}/friends/search?q=", headers=auth(alice)).json() == []


def test_unfriend_revokes_shared_trees_both_directions(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, alice, bob)
    alice_tree = make_tree(db, alice, "Alice Tree")
    bob_tree = make_tree(db, bob, "Bob Tree")
    share(db, alice_tree, bob, "editor")
    share(db, bob_tree, alice, "viewer")

    removed = client.delete(f"{API}/friends/{bob.id}", headers=auth(alice))
    assert removed.status_code == 204

    db.expunge_all()
    assert db.get(TreeMembership, (alice_tree.id, bob.id)) is None
    assert db.get(TreeMembership, (bob_tree.id, alice.id)) is None


def test_block_prevents_requests_and_revokes_shares(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    befriend(db, alice, bob)
    tree = make_tree(db, alice)
    share(db, tree, bob, "editor")

    blocked = client.post(f"{API}/friends/{bob.id}/block", headers=auth(alice))
    assert blocked.status_code == 204
    db.expunge_all()
    assert db.get(TreeMembership, (tree.id, bob.id)) is None

    # Bob can no longer reach Alice with a request.
    assert _send(client, bob, "alice").status_code == 403

    # Unblock removes the relationship entirely.
    unblock = client.delete(f"{API}/friends/{bob.id}/block", headers=auth(alice))
    assert unblock.status_code == 204
    assert _send(client, bob, "alice").status_code == 201
