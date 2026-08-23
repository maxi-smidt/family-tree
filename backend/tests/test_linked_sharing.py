"""Tests for the linked-trees batch sharing endpoints (issue #537).

These are a convenience batch operation layered on top of the existing
per-tree sharing model: every tree keeps its own explicit access list, but
the owner can grant/revoke the same role on the anchor tree plus a batch of
(typically linked) trees in one call.
"""

from tests.conftest import API, add_member, auth, befriend, make_tree, make_user, share


def _link(db, tree, member_id, target_tree, **kw):
    return add_member(
        db, tree, member_id, linked_tree_id=target_tree.id, first_name="A", **kw
    )


# --- GET /access/linked-trees ----------------------------------------------


def test_linked_trees_lists_manageable_and_non_manageable(client, db):
    owner = make_user(db, "owner")
    stranger = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    owned_linked = make_tree(db, owner, "Owned Linked")
    others_linked = make_tree(db, stranger, "Strangers Linked")
    share(db, others_linked, owner, "viewer")
    _link(db, main, "m1", owned_linked)
    _link(db, main, "m2", others_linked)

    res = client.get(
        f"{API}/trees/{main.id}/access/linked-trees", headers=auth(owner)
    )
    assert res.status_code == 200
    body = res.json()
    by_id = {t["tree_id"]: t for t in body}

    assert main.id not in by_id  # anchor tree excluded
    assert by_id[owned_linked.id]["manageable"] is True
    assert by_id[owned_linked.id]["name"] == "Owned Linked"
    assert by_id[others_linked.id]["manageable"] is False
    assert by_id[others_linked.id]["target_role"] is None


def test_linked_trees_unreadable_trees_are_hidden(client, db):
    owner = make_user(db, "owner")
    stranger = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    private_other = make_tree(db, stranger, "Strangers Private")
    _link(db, main, "m1", private_other)

    res = client.get(
        f"{API}/trees/{main.id}/access/linked-trees", headers=auth(owner)
    )
    assert res.status_code == 200
    assert res.json() == []


def test_linked_trees_reports_target_role_with_username(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    main = make_tree(db, owner, "Main")
    linked = make_tree(db, owner, "Linked")
    _link(db, main, "m1", linked)
    share(db, linked, bob, "editor")

    res = client.get(
        f"{API}/trees/{main.id}/access/linked-trees",
        headers=auth(owner),
        params={"username": "bob"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body[0]["target_role"] == "editor"


def test_linked_trees_username_owner_of_linked_tree(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    main = make_tree(db, owner, "Main")
    bobs_tree = make_tree(db, bob, "Bobs Tree")
    share(db, bobs_tree, owner, "viewer")
    _link(db, main, "m1", bobs_tree)

    res = client.get(
        f"{API}/trees/{main.id}/access/linked-trees",
        headers=auth(owner),
        params={"username": "bob"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body[0]["target_role"] == "owner"
    assert body[0]["manageable"] is False


def test_linked_trees_nonexistent_username_404s(client, db):
    owner = make_user(db, "owner")
    main = make_tree(db, owner, "Main")

    res = client.get(
        f"{API}/trees/{main.id}/access/linked-trees",
        headers=auth(owner),
        params={"username": "ghost"},
    )
    assert res.status_code == 404


def test_linked_trees_non_owner_403s(client, db):
    owner = make_user(db, "owner")
    editor = make_user(db, "ed")
    main = make_tree(db, owner, "Main")
    share(db, main, editor, "editor")

    res = client.get(
        f"{API}/trees/{main.id}/access/linked-trees", headers=auth(editor)
    )
    assert res.status_code == 403

# --- POST /access/batch -----------------------------------------------------


def test_batch_grant_happy_path(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    main = make_tree(db, owner, "Main")
    linked1 = make_tree(db, owner, "Linked1")
    linked2 = make_tree(db, owner, "Linked2")
    _link(db, main, "m1", linked1)
    _link(db, main, "m2", linked2)

    res = client.post(
        f"{API}/trees/{main.id}/access/batch",
        headers=auth(owner),
        json={
            "username": "bob",
            "role": "editor",
            "tree_ids": [main.id, linked1.id, linked2.id],
        },
    )
    assert res.status_code == 200
    roles = {m["username"]: m["role"] for m in res.json()}
    assert roles["bob"] == "editor"

    for t in (main, linked1, linked2):
        access = client.get(f"{API}/trees/{t.id}/access", headers=auth(owner)).json()
        bob_entry = next(m for m in access if m["username"] == "bob")
        assert bob_entry["role"] == "editor"


def test_batch_grant_all_or_nothing_rollback(client, db):
    admin = make_user(db, "admin", is_admin=True)
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    linked_good = make_tree(db, owner, "LinkedGood")
    # A tree bob already owns -> triggers a 400 for this specific tree_id
    # (admin actor, so the owner-of-target-tree check is what fires).
    bobs_tree = make_tree(db, bob, "BobsTree")

    res = client.post(
        f"{API}/trees/{main.id}/access/batch",
        headers=auth(admin),
        json={
            "username": "bob",
            "role": "editor",
            "tree_ids": [main.id, linked_good.id, bobs_tree.id],
        },
    )
    assert res.status_code == 400

    # Nothing was granted anywhere, including on the valid trees.
    for t in (main, linked_good):
        access = client.get(f"{API}/trees/{t.id}/access", headers=auth(owner)).json()
        assert "bob" not in {m["username"] for m in access}


def test_batch_grant_non_owned_tree_403s(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    stranger = make_user(db, "carl")
    befriend(db, owner, bob)
    main = make_tree(db, owner, "Main")
    strangers_tree = make_tree(db, stranger, "StrangersTree")

    res = client.post(
        f"{API}/trees/{main.id}/access/batch",
        headers=auth(owner),
        json={
            "username": "bob",
            "role": "editor",
            "tree_ids": [main.id, strangers_tree.id],
        },
    )
    assert res.status_code == 403


def test_batch_grant_friendship_gate_enforced(client, db):
    owner = make_user(db, "owner")
    make_user(db, "bob")  # not a friend
    main = make_tree(db, owner, "Main")
    linked = make_tree(db, owner, "Linked")

    res = client.post(
        f"{API}/trees/{main.id}/access/batch",
        headers=auth(owner),
        json={
            "username": "bob",
            "role": "editor",
            "tree_ids": [main.id, linked.id],
        },
    )
    assert res.status_code == 403
    assert res.json()["detail"] == "You can only share with friends"


def test_batch_grant_role_update_path(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    main = make_tree(db, owner, "Main")
    linked = make_tree(db, owner, "Linked")
    share(db, linked, bob, "viewer")

    res = client.post(
        f"{API}/trees/{main.id}/access/batch",
        headers=auth(owner),
        json={
            "username": "bob",
            "role": "editor",
            "tree_ids": [main.id, linked.id],
        },
    )
    assert res.status_code == 200
    access = client.get(f"{API}/trees/{linked.id}/access", headers=auth(owner)).json()
    bob_entry = next(m for m in access if m["username"] == "bob")
    assert bob_entry["role"] == "editor"


def test_batch_grant_invalid_role_400s(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    main = make_tree(db, owner, "Main")

    res = client.post(
        f"{API}/trees/{main.id}/access/batch",
        headers=auth(owner),
        json={"username": "bob", "role": "superuser", "tree_ids": [main.id]},
    )
    assert res.status_code == 400


def test_batch_grant_too_many_trees_400s(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    main = make_tree(db, owner, "Main")

    res = client.post(
        f"{API}/trees/{main.id}/access/batch",
        headers=auth(owner),
        json={
            "username": "bob",
            "role": "editor",
            "tree_ids": [main.id] * 101,
        },
    )
    assert res.status_code == 400


def test_batch_grant_non_owner_actor_403s(client, db):
    owner = make_user(db, "owner")
    editor = make_user(db, "ed")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    main = make_tree(db, owner, "Main")
    share(db, main, editor, "editor")

    res = client.post(
        f"{API}/trees/{main.id}/access/batch",
        headers=auth(editor),
        json={"username": "bob", "role": "editor", "tree_ids": [main.id]},
    )
    assert res.status_code == 403


# --- POST /access/batch-revoke ----------------------------------------------


def test_batch_revoke_removes_and_skips_absent(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    main = make_tree(db, owner, "Main")
    linked_with = make_tree(db, owner, "LinkedWith")
    linked_without = make_tree(db, owner, "LinkedWithout")
    share(db, main, bob, "editor")
    share(db, linked_with, bob, "editor")
    # bob has no membership on linked_without.

    res = client.post(
        f"{API}/trees/{main.id}/access/batch-revoke",
        headers=auth(owner),
        json={
            "user_id": bob.id,
            "tree_ids": [main.id, linked_with.id, linked_without.id],
        },
    )
    assert res.status_code == 204

    for t in (main, linked_with):
        access = client.get(f"{API}/trees/{t.id}/access", headers=auth(owner)).json()
        assert "bob" not in {m["username"] for m in access}


def test_batch_revoke_non_owned_tree_403s(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    stranger = make_user(db, "carl")
    main = make_tree(db, owner, "Main")
    strangers_tree = make_tree(db, stranger, "StrangersTree")
    share(db, main, bob, "editor")

    res = client.post(
        f"{API}/trees/{main.id}/access/batch-revoke",
        headers=auth(owner),
        json={"user_id": bob.id, "tree_ids": [main.id, strangers_tree.id]},
    )
    assert res.status_code == 403
    # Nothing should have been revoked given the all-or-nothing validation.
    access = client.get(f"{API}/trees/{main.id}/access", headers=auth(owner)).json()
    assert "bob" in {m["username"] for m in access}


def test_batch_revoke_non_owner_actor_403s(client, db):
    owner = make_user(db, "owner")
    editor = make_user(db, "ed")
    bob = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    share(db, main, editor, "editor")
    share(db, main, bob, "editor")

    res = client.post(
        f"{API}/trees/{main.id}/access/batch-revoke",
        headers=auth(editor),
        json={"user_id": bob.id, "tree_ids": [main.id]},
    )
    assert res.status_code == 403
