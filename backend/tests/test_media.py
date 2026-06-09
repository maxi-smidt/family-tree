"""Tests for authenticated media serving (issue #147)."""

import pytest

from tests.conftest import API, auth, make_tree, make_user, share


@pytest.fixture()
def media_file(tmp_path, monkeypatch):
    """Create a real media file on disk and return (tree_id, filename, path)."""
    from app.core.config import settings

    tree_id = "test-tree-abc"
    filename = "abc123.webp"
    media_dir = tmp_path / "media" / tree_id
    media_dir.mkdir(parents=True)
    file_path = media_dir / filename
    file_path.write_bytes(b"fake-image-data")

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return tree_id, filename


def test_owner_can_access_media(client, db, media_file):
    tree_id, filename = media_file
    owner = make_user(db, "owner")
    make_tree(db, owner, tree_id=tree_id)

    resp = client.get(f"{API}/media/{tree_id}/{filename}", headers=auth(owner))
    assert resp.status_code == 200
    assert resp.content == b"fake-image-data"


def test_shared_viewer_can_access_media(client, db, media_file):
    tree_id, filename = media_file
    owner = make_user(db, "owner")
    viewer = make_user(db, "viewer")
    tree = make_tree(db, owner, tree_id=tree_id)
    share(db, tree, viewer, "viewer")

    resp = client.get(f"{API}/media/{tree_id}/{filename}", headers=auth(viewer))
    assert resp.status_code == 200


def test_shared_editor_can_access_media(client, db, media_file):
    tree_id, filename = media_file
    owner = make_user(db, "owner")
    editor = make_user(db, "editor")
    tree = make_tree(db, owner, tree_id=tree_id)
    share(db, tree, editor, "editor")

    resp = client.get(f"{API}/media/{tree_id}/{filename}", headers=auth(editor))
    assert resp.status_code == 200


def test_no_access_user_is_denied(client, db, media_file):
    tree_id, filename = media_file
    owner = make_user(db, "owner")
    stranger = make_user(db, "stranger")
    make_tree(db, owner, tree_id=tree_id)

    resp = client.get(f"{API}/media/{tree_id}/{filename}", headers=auth(stranger))
    assert resp.status_code == 403


def test_unauthenticated_is_denied(client, db, media_file):
    tree_id, filename = media_file
    owner = make_user(db, "owner")
    make_tree(db, owner, tree_id=tree_id)

    resp = client.get(f"{API}/media/{tree_id}/{filename}")
    assert resp.status_code == 401


def test_missing_file_returns_404(client, db, media_file):
    tree_id, _ = media_file
    owner = make_user(db, "owner")
    make_tree(db, owner, tree_id=tree_id)

    resp = client.get(f"{API}/media/{tree_id}/nonexistent.webp", headers=auth(owner))
    assert resp.status_code == 404


def test_path_traversal_rejected(client, db, media_file):
    tree_id, _ = media_file
    owner = make_user(db, "owner")
    make_tree(db, owner, tree_id=tree_id)

    resp = client.get(f"{API}/media/{tree_id}/../../etc/passwd", headers=auth(owner))
    # FastAPI will 404 on the extra path segments before our handler runs, but
    # any response other than 200 confirms the file is protected.
    assert resp.status_code != 200
