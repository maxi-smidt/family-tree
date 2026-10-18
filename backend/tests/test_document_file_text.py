"""Per-file Markdown text for documents (#1121)."""

import pytest

from app.core.config import settings
from app.db.base import utcnow_iso
from app.models import (
    ActivityLog,
    Document,
    DocumentFile,
    DocumentFileText,
    WorkspaceMembership,
)
from app.services import crypto_export
from app.services.workspaces.merge import merge_trees
from tests.conftest import API, add_member, auth, make_tree, make_user, wait_for_job


@pytest.fixture()
def media_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return settings.media_root


def _setup(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="A")
    return user, tree


def _create_with_file(client, user, tree, content, filename, mime, doc_id="doc-1"):
    staged = client.post(
        f"{API}/workspaces/{tree.id}/documents/uploads",
        headers=auth(user),
        data={"filename": filename},
        files={"file": (filename, content, mime)},
    )
    assert staged.status_code == 201, staged.text
    saved = client.put(
        f"{API}/workspaces/{tree.id}/documents/{doc_id}",
        headers=auth(user),
        json={
            "title": "Letter",
            "member_ids": ["m1"],
            "attached_upload_ids": [staged.json()["id"]],
        },
    )
    assert saved.status_code == 200, saved.text
    return saved.json()["files"][0]["id"]


def _text_url(tree, file_id, doc_id="doc-1"):
    return f"{API}/workspaces/{tree.id}/documents/{doc_id}/files/{file_id}/text"


def _list_files(client, user, tree):
    docs = client.get(f"{API}/workspaces/{tree.id}/documents", headers=auth(user)).json()
    return docs[0]["files"]


def test_file_without_text_returns_null(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(client, user, tree, b"hello", "note.txt", "text/plain")

    assert _list_files(client, user, tree)[0]["has_text"] is False
    response = client.get(_text_url(tree, file_id), headers=auth(user))
    assert response.status_code == 200
    assert response.json() is None


def test_save_edit_and_clear_text(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(client, user, tree, b"\x89PNG", "scan.png", "image/png")

    saved = client.put(
        _text_url(tree, file_id),
        headers=auth(user),
        json={"markdown": "# Geburtsurkunde\n\nJohann *Schmidt*", "language": "de"},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["markdown"] == "# Geburtsurkunde\n\nJohann *Schmidt*"
    assert body["language"] == "de"
    assert body["source"] == "manual"
    assert body["edited_by"] == user.id
    assert _list_files(client, user, tree)[0]["has_text"] is True

    cleared = client.put(
        _text_url(tree, file_id), headers=auth(user), json={"markdown": "  "}
    )
    assert cleared.status_code == 200
    assert cleared.json() is None
    assert _list_files(client, user, tree)[0]["has_text"] is False


def test_links_have_no_text(client, db, media_root):
    user, tree = _setup(db)
    saved = client.put(
        f"{API}/workspaces/{tree.id}/documents/doc-1",
        headers=auth(user),
        json={
            "title": "Link",
            "member_ids": [],
            "added_links": [
                {"id": "link-1", "url": "https://example.com", "filename": None}
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    response = client.put(
        _text_url(tree, "link-1"), headers=auth(user), json={"markdown": "x"}
    )
    assert response.status_code == 400


def test_deleting_the_file_removes_its_text(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(client, user, tree, b"\x89PNG", "scan.png", "image/png")
    client.put(_text_url(tree, file_id), headers=auth(user), json={"markdown": "Text"})
    response = client.delete(
        f"{API}/workspaces/{tree.id}/documents/doc-1/files/{file_id}", headers=auth(user)
    )
    assert response.status_code == 204
    db.expire_all()
    assert db.get(DocumentFileText, file_id) is None


def test_viewer_reads_but_cannot_edit(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(client, user, tree, b"\x89PNG", "scan.png", "image/png")
    viewer = make_user(db, "viewer")
    db.add(WorkspaceMembership(workspace_id=tree.id, user_id=viewer.id, role="viewer"))
    db.commit()

    assert client.get(_text_url(tree, file_id), headers=auth(viewer)).status_code == 200
    response = client.put(
        _text_url(tree, file_id), headers=auth(viewer), json={"markdown": "changed"}
    )
    assert response.status_code == 403


def test_hidden_documents_area_hides_the_text(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(client, user, tree, b"\x89PNG", "scan.png", "image/png")
    guest = make_user(db, "guest")
    db.add(
        WorkspaceMembership(
            workspace_id=tree.id,
            user_id=guest.id,
            role="viewer",
            restrictions=["sources"],
        )
    )
    db.commit()

    response = client.get(_text_url(tree, file_id), headers=auth(guest))
    assert response.status_code in (403, 404)


def test_export_import_round_trips_the_text(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(client, user, tree, b"\x89PNG", "scan.png", "image/png")
    client.put(
        _text_url(tree, file_id), headers=auth(user), json={"markdown": "Korrigiert"}
    )

    exported = client.post(
        f"{API}/workspaces/{tree.id}/export", headers=auth(user), json={}
    )
    assert exported.status_code == 200
    bundle = crypto_export.decrypt_bundle(exported.content, None)
    assert [t["markdown"] for t in bundle["document_file_texts"]] == ["Korrigiert"]

    started = client.post(
        f"{API}/workspaces/import",
        headers=auth(user),
        files={"file": ("tree.treedb", exported.content, "application/octet-stream")},
    )
    assert started.status_code in (200, 202), started.text
    new_tree_id = wait_for_job(client, auth(user), started.json()["job_id"])

    docs = client.get(
        f"{API}/workspaces/{new_tree_id}/documents", headers=auth(user)
    ).json()
    new_file = docs[0]["files"][0]
    assert new_file["id"] != file_id
    assert new_file["has_text"] is True
    text = client.get(
        f"{API}/workspaces/{new_tree_id}/documents/{docs[0]['id']}/files/"
        f"{new_file['id']}/text",
        headers=auth(user),
    ).json()
    assert text["markdown"] == "Korrigiert"
    assert text["edited_by"] is None


def test_merge_copies_file_texts(db):
    user = make_user(db, "alice")
    source = make_tree(db, user, "Source")
    now = utcnow_iso()
    db.add(
        Document(
            id="doc1",
            workspace_id=source.id,
            title="Brief",
            created_at=now,
            updated_at=now,
        )
    )
    db.add(
        DocumentFile(
            id="df1",
            workspace_id=source.id,
            document_id="doc1",
            kind="file",
            filename="brief.png",
            url=f"/api/media/{source.id}/missing.png",
            mime_type="image/png",
            created_at=now,
        )
    )
    db.flush()
    db.add(
        DocumentFileText(
            document_file_id="df1",
            workspace_id=source.id,
            markdown="Lieber Hans,",
            source="manual",
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()

    merged = merge_trees(db, user, "Copy", source.id, None)

    texts = db.query(DocumentFileText).filter_by(workspace_id=merged.id).all()
    assert [t.markdown for t in texts] == ["Lieber Hans,"]
    copied_file = db.get(DocumentFile, texts[0].document_file_id)
    assert copied_file.workspace_id == merged.id
    assert copied_file.id != "df1"


def test_undo_file_delete_restores_its_text(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(client, user, tree, b"\x89PNG", "scan.png", "image/png")
    client.put(_text_url(tree, file_id), headers=auth(user), json={"markdown": "Text"})
    client.delete(
        f"{API}/workspaces/{tree.id}/documents/doc-1/files/{file_id}", headers=auth(user)
    )
    entry = (
        db.query(ActivityLog)
        .filter_by(workspace_id=tree.id, action="delete", target_type="document_file")
        .one()
    )

    undone = client.post(
        f"{API}/workspaces/{tree.id}/activity/{entry.id}/undo", headers=auth(user)
    )
    assert undone.status_code == 200, undone.text
    db.expire_all()
    assert db.get(DocumentFileText, file_id).markdown == "Text"


def test_undo_document_delete_restores_file_texts(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(client, user, tree, b"\x89PNG", "scan.png", "image/png")
    client.put(_text_url(tree, file_id), headers=auth(user), json={"markdown": "Text"})
    client.delete(f"{API}/workspaces/{tree.id}/documents/doc-1", headers=auth(user))
    entry = (
        db.query(ActivityLog)
        .filter_by(workspace_id=tree.id, action="delete", target_type="document")
        .one()
    )

    undone = client.post(
        f"{API}/workspaces/{tree.id}/activity/{entry.id}/undo", headers=auth(user)
    )
    assert undone.status_code == 200, undone.text
    db.expire_all()
    assert db.get(DocumentFileText, file_id).markdown == "Text"
