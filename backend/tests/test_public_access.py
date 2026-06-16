"""Tests for public read-only tree mode (issue #165)."""

from tests.conftest import API, auth, make_tree, make_user


def test_owner_can_enable_public_read(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    r = client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    assert r.status_code == 200
    assert r.json()["public_role"] == "viewer"


def test_owner_can_disable_public_read(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    r = client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": None},
        headers=auth(alice),
    )
    assert r.status_code == 200
    assert r.json()["public_role"] is None


def test_invalid_public_role_rejected(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    r = client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "editor"},
        headers=auth(alice),
    )
    assert r.status_code == 400


def test_non_owner_cannot_change_public(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)

    from tests.conftest import share

    share(db, tree, bob, role="editor")

    r = client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(bob),
    )
    assert r.status_code == 403


def test_public_tree_readable_without_auth(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )

    r = client.get(f"{API}/trees/{tree.id}")
    assert r.status_code == 200
    assert r.json()["id"] == tree.id


def test_private_tree_not_readable_without_auth(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    r = client.get(f"{API}/trees/{tree.id}")
    assert r.status_code == 401


def test_public_tree_not_writable_without_auth(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )

    r = client.patch(f"{API}/trees/{tree.id}", json={"name": "Hacked"})
    assert r.status_code == 401
