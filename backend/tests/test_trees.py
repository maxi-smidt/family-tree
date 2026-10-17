from app.main import app
from tests.conftest import API, auth, make_tree, make_user, share

# Every (method, path) that used to be defined in the single workspaces.py before
# it was split (#894) into workspaces.py / tree_public.py / tree_sharing.py /
# tree_jobs.py / tree_transfer.py.
_SPLIT_OPERATIONS = {
    ("get", "/api/workspaces"),
    ("post", "/api/workspaces"),
    ("post", "/api/workspaces/merge/preview"),
    ("post", "/api/workspaces/merge"),
    ("get", "/api/workspaces/{workspace_id}"),
    ("get", "/api/workspaces/{workspace_id}/metadata"),
    ("get", "/api/workspaces/{workspace_id}/storage"),
    ("patch", "/api/workspaces/{workspace_id}"),
    ("delete", "/api/workspaces/{workspace_id}"),
    ("patch", "/api/workspaces/{workspace_id}/public"),
    ("put", "/api/workspaces/{workspace_id}/public/password"),
    ("post", "/api/workspaces/{workspace_id}/public/unlock"),
    ("get", "/api/workspaces/{workspace_id}/access"),
    ("get", "/api/workspaces/{workspace_id}/access/candidates"),
    ("post", "/api/workspaces/{workspace_id}/access"),
    ("delete", "/api/workspaces/{workspace_id}/access/{user_id}"),
    ("post", "/api/workspaces/{workspace_id}/access/batch"),
    ("post", "/api/workspaces/{workspace_id}/access/batch-revoke"),
    ("patch", "/api/workspaces/{workspace_id}/access/{user_id}/restrictions"),
    ("post", "/api/workspaces/{workspace_id}/transfer"),
    ("post", "/api/workspaces/{workspace_id}/transfer/revert"),
}


def test_split_tree_routers_keep_a_single_openapi_tag():
    """The router split (#894) must not change the public OpenAPI contract:
    every operation that used to live in workspaces.py keeps the single "workspaces"
    tag, regardless of which module now defines it, so generated-client
    grouping by tag is unaffected."""
    spec = app.openapi()
    seen = set()
    for path, methods in spec["paths"].items():
        for method, operation in methods.items():
            if (method, path) in _SPLIT_OPERATIONS:
                seen.add((method, path))
                assert operation.get("tags") == ["workspaces"], (method, path)
    assert seen == _SPLIT_OPERATIONS


def test_create_tree(client, db):
    user = make_user(db, "alice")
    res = client.post(f"{API}/workspaces", headers=auth(user), json={"name": "Smiths"})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "Smiths"
    assert body["role"] == "owner"


def test_create_tree_ignores_client_supplied_id(client, db):
    user = make_user(db, "server-id-owner")
    chosen_id = "attacker-controlled-tree-id"

    res = client.post(
        f"{API}/workspaces",
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

    res = client.get(f"{API}/workspaces", headers=auth(owner))
    assert res.status_code == 200
    by_id = {t["id"]: t for t in res.json()}
    assert by_id[owned.id]["role"] == "owner"
    assert by_id[shared.id]["role"] == "viewer"


def test_list_trees_for_admin_excludes_unshared_user_trees(client, db):
    admin = make_user(db, "admin", is_admin=True)
    owner = make_user(db, "owner")
    admin_tree = make_tree(db, admin, "Admin Workspace")
    owner_tree = make_tree(db, owner, "Owner Workspace")
    shared_tree = make_tree(db, owner, "Shared Workspace")
    share(db, shared_tree, admin, "viewer")

    res = client.get(f"{API}/workspaces", headers=auth(admin))
    assert res.status_code == 200
    ids = {t["id"] for t in res.json()}
    assert admin_tree.id in ids
    assert shared_tree.id in ids
    assert owner_tree.id not in ids
    assert (
        client.get(f"{API}/workspaces/{owner_tree.id}", headers=auth(admin)).status_code
        == 200
    )


def test_get_tree_updates_last_opened(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    res = client.get(f"{API}/workspaces/{tree.id}", headers=auth(user))
    assert res.status_code == 200
    # Opening the tree stamps last_opened for the requesting user.
    assert res.json()["last_opened"] is not None


def test_collaborator_opening_shared_tree_does_not_reorder_owners_list(client, db):
    """#878: last-opened is per user, so one collaborator opening a shared
    tree must not change another collaborator's — or the owner's — ordering
    of their own recent-tree list."""
    owner = make_user(db, "owner")
    collaborator = make_user(db, "collaborator")
    older = make_tree(db, owner, "Older")
    newer = make_tree(db, owner, "Newer")
    share(db, older, collaborator, "viewer")
    share(db, newer, collaborator, "viewer")

    # The owner opens "Older" last, so it should sort first for the owner.
    assert (
        client.get(f"{API}/workspaces/{newer.id}", headers=auth(owner)).status_code == 200
    )
    assert (
        client.get(f"{API}/workspaces/{older.id}", headers=auth(owner)).status_code == 200
    )

    # The collaborator opens "Newer" afterwards — this is their own activity
    # and must not affect the owner's ordering computed above.
    assert (
        client.get(f"{API}/workspaces/{newer.id}", headers=auth(collaborator)).status_code
        == 200
    )

    owner_ids = [
        t["id"] for t in client.get(f"{API}/workspaces", headers=auth(owner)).json()
    ]
    assert owner_ids == [older.id, newer.id]

    collaborator_ids = [
        t["id"]
        for t in client.get(f"{API}/workspaces", headers=auth(collaborator)).json()
    ]
    assert collaborator_ids == [newer.id, older.id]


def test_only_owner_can_delete_tree(client, db):
    owner = make_user(db, "owner")
    editor = make_user(db, "ed")
    tree = make_tree(db, owner)
    share(db, tree, editor, "editor")

    assert (
        client.delete(f"{API}/workspaces/{tree.id}", headers=auth(editor)).status_code
        == 403
    )
    assert (
        client.delete(f"{API}/workspaces/{tree.id}", headers=auth(owner)).status_code
        == 204
    )


def test_unknown_tree_is_404(client, db):
    user = make_user(db, "alice")
    assert client.get(f"{API}/workspaces/nope", headers=auth(user)).status_code == 404
