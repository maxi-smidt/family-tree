"""Purge of expired pending-deletion users + on-disk media cleanup."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.core.config import settings
from app.models import GalleryImage, User, Workspace, WorkspaceMembership
from app.services.media.storage import MEDIA_URL_PREFIX, delete_workspace_media
from app.services.system.user_purge import find_due_users, purge_due_users
from tests.conftest import API, auth, make_tree, make_user, share


@pytest.fixture()
def media_root(tmp_path, monkeypatch):
    """Point media storage at the test's tmp dir."""
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return settings.media_root


def _past() -> str:
    return (datetime.now(UTC) - timedelta(days=1)).isoformat()


def _future() -> str:
    return (datetime.now(UTC) + timedelta(days=1)).isoformat()


def _write_tree_media(workspace_id: str, name: str = "f.webp") -> object:
    directory = settings.media_root / workspace_id
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(b"binary-content")
    return path


def _schedule(db, user: User, when: str) -> None:
    user.deletion_scheduled_for = when
    user.deletion_requested_at = when
    db.commit()


def test_find_due_users_selects_only_past_deadlines(db):
    overdue = make_user(db, "overdue")
    not_yet = make_user(db, "notyet")
    never = make_user(db, "never")
    _schedule(db, overdue, _past())
    _schedule(db, not_yet, _future())

    due_ids = {u.id for u in find_due_users(db)}
    assert overdue.id in due_ids
    assert not_yet.id not in due_ids
    assert never.id not in due_ids


def test_purge_removes_user_owned_trees_and_media(db, media_root):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)
    media_file = _write_tree_media(tree.id)
    assert media_file.exists()
    _schedule(db, alice, _past())

    assert purge_due_users(db) == 1
    db.expunge_all()  # conftest keeps objects after commit; re-read from the DB

    assert db.get(User, alice.id) is None
    assert db.get(Workspace, tree.id) is None
    assert not media_file.exists()
    assert not (settings.media_root / tree.id).exists()


def test_purge_skips_users_before_deadline(db, media_root):
    bob = make_user(db, "bob")
    tree = make_tree(db, bob)
    media_file = _write_tree_media(tree.id)
    _schedule(db, bob, _future())

    assert purge_due_users(db) == 0

    assert db.get(User, bob.id) is not None
    assert media_file.exists()


def test_purge_keeps_trees_owned_by_others(db):
    alice = make_user(db, "alice")
    carol = make_user(db, "carol")
    shared = make_tree(db, carol, name="Carol's tree")
    share(db, shared, alice, role="editor")
    _schedule(db, alice, _past())

    assert purge_due_users(db) == 1
    db.expunge_all()  # conftest keeps objects after commit; re-read from the DB

    # Carol's tree survives; only Alice's membership is gone.
    assert db.get(Workspace, shared.id) is not None
    assert db.get(WorkspaceMembership, (shared.id, alice.id)) is None


def test_delete_tree_route_removes_media(client, db, media_root):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)
    media_file = _write_tree_media(tree.id)

    res = client.delete(f"{API}/workspaces/{tree.id}", headers=auth(owner))
    assert res.status_code == 204
    assert not media_file.exists()


def test_delete_image_route_removes_file(client, db, media_root):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)
    media_file = _write_tree_media(tree.id, name="img.webp")
    image = GalleryImage(
        id=str(uuid4()),
        workspace_id=tree.id,
        image_data=f"{MEDIA_URL_PREFIX}/{tree.id}/img.webp",
    )
    db.add(image)
    db.commit()

    res = client.delete(
        f"{API}/workspaces/{tree.id}/gallery/images/{image.id}", headers=auth(owner)
    )
    assert res.status_code == 204
    assert not media_file.exists()


def test_delete_workspace_media_is_safe(media_root):
    # Missing directory: no-op, no raise.
    delete_workspace_media("does-not-exist")
    # Path-traversal attempt is rejected without touching anything outside root.
    sentinel = settings.media_root.parent / "keep.txt"
    settings.media_root.mkdir(parents=True, exist_ok=True)
    sentinel.write_text("keep")
    delete_workspace_media("../")
    assert sentinel.exists()
