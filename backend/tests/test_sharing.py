from tests.conftest import API, auth, befriend, make_tree, make_user, share

_TS = "2000-01-01T00:00:00Z"


def test_owner_can_share_and_revoke(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    shared = client.post(
        f"{API}/workspaces/{tree.id}/access",
        headers=auth(owner),
        json={"username": "bob", "role": "viewer"},
    )
    assert shared.status_code == 200
    roles = {m["username"]: m["role"] for m in shared.json()}
    assert roles == {"owner": "owner", "bob": "viewer"}

    revoked = client.delete(
        f"{API}/workspaces/{tree.id}/access/{bob.id}", headers=auth(owner)
    )
    assert revoked.status_code == 204
    after = client.get(f"{API}/workspaces/{tree.id}/access", headers=auth(owner)).json()
    assert {m["username"] for m in after} == {"owner"}


def test_share_rejects_invalid_role(client, db):
    owner = make_user(db, "owner")
    make_user(db, "bob")
    tree = make_tree(db, owner)
    res = client.post(
        f"{API}/workspaces/{tree.id}/access",
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
        f"{API}/workspaces/{tree.id}/access",
        headers=auth(editor),
        json={"username": "bob", "role": "viewer"},
    )
    assert res.status_code == 403


def test_share_candidates_are_friends_minus_members(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    carol = make_user(db, "carol")
    make_user(db, "dave")  # a friend-less stranger, must never appear
    befriend(db, owner, bob)
    befriend(db, owner, carol)
    tree = make_tree(db, owner)
    share(db, tree, bob, "editor")

    res = client.get(f"{API}/workspaces/{tree.id}/access/candidates", headers=auth(owner))
    assert res.status_code == 200
    # bob is already a member; carol is a friend without access; dave is neither.
    assert {c["username"] for c in res.json()} == {"carol"}


def test_shared_editor_has_no_default_restrictions(client, db):
    """A directly-shared editor must be able to edit stories, events, etc.

    Regression: DEFAULT_RESTRICTIONS previously included every content domain,
    making freshly-shared editors unable to access anything beyond the tree.
    """
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    res = client.post(
        f"{API}/workspaces/{tree.id}/access",
        headers=auth(owner),
        json={"username": "bob", "role": "editor"},
    )
    assert res.status_code == 200
    bob_entry = next(m for m in res.json() if m["username"] == "bob")
    assert bob_entry["restrictions"] == []

    # Editor must be able to create a story without a 404 from require_domain.
    story_res = client.post(
        f"{API}/workspaces/{tree.id}/stories",
        headers=auth(bob),
        json={"id": "s1", "title": "A tale", "created_at": _TS, "updated_at": _TS},
    )
    assert story_res.status_code == 201


def test_share_requires_friendship(client, db):
    owner = make_user(db, "owner")
    make_user(db, "stranger")
    tree = make_tree(db, owner)

    res = client.post(
        f"{API}/workspaces/{tree.id}/access",
        headers=auth(owner),
        json={"username": "stranger", "role": "viewer"},
    )
    assert res.status_code == 403
