from tests.conftest import API, auth, make_tree, make_user, share


def test_owner_can_share_and_revoke(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    tree = make_tree(db, owner)

    shared = client.post(
        f"{API}/trees/{tree.id}/access",
        headers=auth(owner),
        json={"username": "bob", "role": "viewer"},
    )
    assert shared.status_code == 200
    roles = {m["username"]: m["role"] for m in shared.json()}
    assert roles == {"owner": "owner", "bob": "viewer"}

    revoked = client.delete(
        f"{API}/trees/{tree.id}/access/{bob.id}", headers=auth(owner)
    )
    assert revoked.status_code == 204
    after = client.get(f"{API}/trees/{tree.id}/access", headers=auth(owner)).json()
    assert {m["username"] for m in after} == {"owner"}


def test_share_rejects_invalid_role(client, db):
    owner = make_user(db, "owner")
    make_user(db, "bob")
    tree = make_tree(db, owner)
    res = client.post(
        f"{API}/trees/{tree.id}/access",
        headers=auth(owner),
        json={"username": "bob", "role": "superuser"},
    )
    assert res.status_code == 400


def test_non_owner_cannot_share(client, db):
    owner = make_user(db, "owner")
    editor = make_user(db, "ed")
    make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, editor, "editor")

    res = client.post(
        f"{API}/trees/{tree.id}/access",
        headers=auth(editor),
        json={"username": "bob", "role": "viewer"},
    )
    assert res.status_code == 403


def test_share_candidates_excludes_owner_and_members(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    carol = make_user(db, "carol")
    tree = make_tree(db, owner)
    share(db, tree, bob, "editor")

    res = client.get(f"{API}/trees/{tree.id}/access/candidates", headers=auth(owner))
    assert res.status_code == 200
    usernames = {c["username"] for c in res.json()}
    assert usernames == {"carol"}
    assert carol.username in usernames
