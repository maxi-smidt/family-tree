from tests.conftest import API, auth, make_tree, make_user, share


def test_create_tree(client, db):
    user = make_user(db, "alice")
    res = client.post(f"{API}/trees", headers=auth(user), json={"name": "Smiths"})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "Smiths"
    assert body["role"] == "owner"


def test_create_tree_ignores_client_supplied_id(client, db):
    user = make_user(db, "server-id-owner")
    chosen_id = "attacker-controlled-tree-id"

    res = client.post(
        f"{API}/trees",
        headers=auth(user),
        json={"name": "Server ID", "id": chosen_id},
    )

    assert res.status_code == 201
    assert res.json()["id"] != chosen_id


def test_list_trees_includes_owned_and_shared(client, db):
    owner = make_user(db, "owner")
    other = make_user(db, "bob")
    owned = make_tree(db, owner, "Owned")
    shared = make_tree(db, other, "Shared")
    share(db, shared, owner, "viewer")

    res = client.get(f"{API}/trees", headers=auth(owner))
    assert res.status_code == 200
    by_id = {t["id"]: t for t in res.json()}
    assert by_id[owned.id]["role"] == "owner"
    assert by_id[shared.id]["role"] == "viewer"


def test_list_trees_for_admin_excludes_unshared_user_trees(client, db):
    admin = make_user(db, "admin", is_admin=True)
    owner = make_user(db, "owner")
    admin_tree = make_tree(db, admin, "Admin Tree")
    owner_tree = make_tree(db, owner, "Owner Tree")
    shared_tree = make_tree(db, owner, "Shared Tree")
    share(db, shared_tree, admin, "viewer")

    res = client.get(f"{API}/trees", headers=auth(admin))
    assert res.status_code == 200
    ids = {t["id"] for t in res.json()}
    assert admin_tree.id in ids
    assert shared_tree.id in ids
    assert owner_tree.id not in ids
    assert (
        client.get(f"{API}/trees/{owner_tree.id}", headers=auth(admin)).status_code
        == 200
    )


def test_get_tree_updates_last_opened(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    assert tree.last_opened is None  # helper leaves it unset
    res = client.get(f"{API}/trees/{tree.id}", headers=auth(user))
    assert res.status_code == 200
    # Opening the tree stamps last_opened.
    assert res.json()["last_opened"] is not None


def test_only_owner_can_delete_tree(client, db):
    owner = make_user(db, "owner")
    editor = make_user(db, "ed")
    tree = make_tree(db, owner)
    share(db, tree, editor, "editor")

    assert (
        client.delete(f"{API}/trees/{tree.id}", headers=auth(editor)).status_code == 403
    )
    assert (
        client.delete(f"{API}/trees/{tree.id}", headers=auth(owner)).status_code == 204
    )


def test_unknown_tree_is_404(client, db):
    user = make_user(db, "alice")
    assert client.get(f"{API}/trees/nope", headers=auth(user)).status_code == 404
