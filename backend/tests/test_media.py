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


def _attach_document_file(db, tree_id, url, *, filename, mime="image/webp"):
    """Create a Document + DocumentFile referencing an on-disk media URL."""
    from uuid import uuid4

    from app.db.base import utcnow_iso
    from app.models import Document, DocumentFile

    now = utcnow_iso()
    document = Document(
        id=str(uuid4()),
        tree_id=tree_id,
        title="Doc",
        created_at=now,
        updated_at=now,
    )
    db.add(document)
    db.flush()
    db.add(
        DocumentFile(
            id=str(uuid4()),
            tree_id=tree_id,
            document_id=document.id,
            kind="file",
            filename=filename,
            url=url,
            mime_type=mime,
            size=15,
            created_at=now,
        )
    )
    db.commit()


def test_document_download_uses_original_filename(client, db, media_file):
    tree_id, filename = media_file
    owner = make_user(db, "owner")
    make_tree(db, owner, tree_id=tree_id)
    _attach_document_file(
        db,
        tree_id,
        f"{API}/media/{tree_id}/{filename}",
        filename="certificate.webp",
    )

    resp = client.get(f"{API}/media/{tree_id}/{filename}", headers=auth(owner))
    assert resp.status_code == 200
    cd = resp.headers["content-disposition"]
    assert cd.startswith("attachment")
    # A plain ASCII name uses the quoted filename form.
    assert 'filename="certificate.webp"' in cd


def test_document_download_rfc5987_encodes_non_ascii_filename(client, db, media_file):
    tree_id, filename = media_file
    owner = make_user(db, "owner")
    make_tree(db, owner, tree_id=tree_id)
    _attach_document_file(
        db,
        tree_id,
        f"{API}/media/{tree_id}/{filename}",
        filename="Ahnenpaß Müller.webp",
    )

    resp = client.get(f"{API}/media/{tree_id}/{filename}", headers=auth(owner))
    assert resp.status_code == 200
    cd = resp.headers["content-disposition"]
    # Non-ASCII names use the RFC 5987 filename* form (percent-encoded UTF-8).
    assert "filename*=utf-8''" in cd
    assert "M%C3%BCller" in cd


def test_media_without_document_record_has_no_disposition(client, db, media_file):
    # Member photos / gallery images have no stored original name and must keep
    # serving inline (no Content-Disposition), unchanged by the download fix.
    tree_id, filename = media_file
    owner = make_user(db, "owner")
    make_tree(db, owner, tree_id=tree_id)

    resp = client.get(f"{API}/media/{tree_id}/{filename}", headers=auth(owner))
    assert resp.status_code == 200
    assert "content-disposition" not in resp.headers
