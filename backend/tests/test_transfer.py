"""Tree ownership transfer."""

from app.models import Tree, TreeMembership
from tests.conftest import API, auth, make_tree, make_user, share


def _transfer(client, actor, tree, username):
    return client.post(
        f"{API}/trees/{tree.id}/transfer",
        headers=auth(actor),
        json={"username": username},
    )


def test_owner_can_transfer_to_member(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, bob, "editor")

    res = _transfer(client, owner, tree, "bob")
    assert res.status_code == 200
    # Bob is now the sole entry: he's owner, and his old membership is gone.
    assert {m["username"]: m["role"] for m in res.json()} == {"bob": "owner"}

    db.expunge_all()
    assert db.get(Tree, tree.id).owner_id == bob.id
    assert db.get(TreeMembership, (tree.id, bob.id)) is None


def test_owner_can_transfer_to_non_member(client, db):
    owner = make_user(db, "owner")
    make_user(db, "carol")
    tree = make_tree(db, owner)

    res = _transfer(client, owner, tree, "carol")
    assert res.status_code == 200
    assert {m["username"]: m["role"] for m in res.json()} == {"carol": "owner"}


def test_admin_can_transfer_any_tree(client, db):
    admin = make_user(db, "admin", is_admin=True)
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    tree = make_tree(db, owner)

    res = _transfer(client, admin, tree, "bob")
    assert res.status_code == 200
    db.expunge_all()
    assert db.get(Tree, tree.id).owner_id == bob.id


def test_non_owner_non_admin_cannot_transfer(client, db):
    owner = make_user(db, "owner")
    editor = make_user(db, "ed")
    make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, editor, "editor")

    assert _transfer(client, editor, tree, "bob").status_code == 403


def test_transfer_to_inactive_user_rejected(client, db):
    owner = make_user(db, "owner")
    make_user(db, "ghost", is_active=False)
    tree = make_tree(db, owner)

    assert _transfer(client, owner, tree, "ghost").status_code == 400


def test_transfer_to_current_owner_rejected(client, db):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)

    assert _transfer(client, owner, tree, "owner").status_code == 400


def test_transfer_to_unknown_user_404(client, db):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)

    assert _transfer(client, owner, tree, "nobody").status_code == 404
