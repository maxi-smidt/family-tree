"""Tree ownership transfer and undo."""

from datetime import UTC, datetime, timedelta

from app.models import Tree, TreeMembership
from tests.conftest import API, auth, befriend, make_tree, make_user, share


def _transfer(client, actor, tree, username, **kwargs):
    return client.post(
        f"{API}/trees/{tree.id}/transfer",
        headers=auth(actor),
        json={"username": username, **kwargs},
    )


def _revert(client, actor, tree):
    return client.post(
        f"{API}/trees/{tree.id}/transfer/revert",
        headers=auth(actor),
    )


def _access_by_username(res):
    return {m["username"]: m["role"] for m in res.json()["access"]}


def test_owner_can_transfer_to_member(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)
    share(db, tree, bob, "editor")

    res = _transfer(client, owner, tree, "bob")
    assert res.status_code == 200
    assert _access_by_username(res) == {"bob": "owner"}
    assert res.json()["undo_available_until"] is not None

    db.expunge_all()
    assert db.get(Tree, tree.id).owner_id == bob.id
    assert db.get(TreeMembership, (tree.id, bob.id)) is None


def test_owner_can_transfer_to_non_member(client, db):
    owner = make_user(db, "owner")
    carol = make_user(db, "carol")
    befriend(db, owner, carol)
    tree = make_tree(db, owner)

    res = _transfer(client, owner, tree, "carol")
    assert res.status_code == 200
    assert _access_by_username(res) == {"carol": "owner"}


def test_transfer_requires_friendship(client, db):
    owner = make_user(db, "owner")
    make_user(db, "stranger")
    tree = make_tree(db, owner)

    assert _transfer(client, owner, tree, "stranger").status_code == 403


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


# --- retain_role ---

def test_retain_role_viewer_creates_membership(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    res = _transfer(client, owner, tree, "bob", retain_role="viewer")
    assert res.status_code == 200
    access = _access_by_username(res)
    assert access["bob"] == "owner"
    assert access["owner"] == "viewer"

    db.expunge_all()
    m = db.get(TreeMembership, (tree.id, owner.id))
    assert m is not None
    assert m.role == "viewer"


def test_retain_role_editor_creates_membership(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    res = _transfer(client, owner, tree, "bob", retain_role="editor")
    assert res.status_code == 200
    assert _access_by_username(res)["owner"] == "editor"


def test_invalid_retain_role_rejected(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    assert _transfer(client, owner, tree, "bob", retain_role="owner").status_code == 400


# --- revert ---

def test_previous_owner_can_revert_within_window(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    _transfer(client, owner, tree, "bob")

    res = _revert(client, owner, tree)
    assert res.status_code == 200
    assert _access_by_username(res) == {"owner": "owner"}

    db.expunge_all()
    t = db.get(Tree, tree.id)
    assert t.owner_id == owner.id
    assert t.previous_owner_id is None


def test_revert_removes_retained_membership(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    _transfer(client, owner, tree, "bob", retain_role="viewer")

    res = _revert(client, owner, tree)
    assert res.status_code == 200

    db.expunge_all()
    # The retained-access membership should be gone after undo.
    assert db.get(TreeMembership, (tree.id, owner.id)) is None


def test_non_previous_owner_cannot_revert(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    carol = make_user(db, "carol")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    _transfer(client, owner, tree, "bob")

    assert _revert(client, carol, tree).status_code == 403


def test_revert_after_window_returns_410(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    _transfer(client, owner, tree, "bob")

    # Backdate the transfer timestamp to beyond the undo window.
    db.expunge_all()
    t = db.get(Tree, tree.id)
    past = datetime.now(UTC) - timedelta(seconds=120)
    t.ownership_transferred_at = past.isoformat()
    db.commit()

    assert _revert(client, owner, tree).status_code == 410


def test_revert_with_no_transfer_returns_400(client, db):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)

    assert _revert(client, owner, tree).status_code == 400


def test_admin_can_revert_any_transfer(client, db):
    admin = make_user(db, "admin", is_admin=True)
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    _transfer(client, owner, tree, "bob")

    res = _revert(client, admin, tree)
    assert res.status_code == 200
    db.expunge_all()
    assert db.get(Tree, tree.id).owner_id == owner.id
