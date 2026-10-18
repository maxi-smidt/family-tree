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
from app.services.documents.file_text import pdf_text_markdown
from app.services.workspaces.merge import merge_trees
from tests.conftest import API, add_member, auth, make_tree, make_user, wait_for_job


@pytest.fixture()
def media_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return settings.media_root


def _pdf(*pages: str) -> bytes:
    """A minimal valid PDF whose pages carry *pages* as their text layer
    (an empty string makes a page without text, like a scan)."""
    objects: list[bytes] = []
    page_ids = [3 + 2 * i for i in range(len(pages))]
    font_id = 3 + 2 * len(pages)
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{pid} 0 R" for pid in page_ids).encode()
    objects.append(b"<< /Type /Pages /Kids [" + kids + b"] /Count %d >>" % len(pages))
    for i, text in enumerate(pages):
        content = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode() if text else b""
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (font_id, page_ids[i] + 1)
        )
        objects.append(
            b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream"
        )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


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


def test_pdf_text_markdown_marks_pages(tmp_path):
    path = tmp_path / "two.pdf"
    path.write_bytes(_pdf("Erste Seite", "", "Dritte Seite"))
    assert pdf_text_markdown(path) == (
        "<!-- page 1 -->\n\nErste Seite\n\n<!-- page 2 -->\n\n<!-- page 3 -->"
        "\n\nDritte Seite"
    )


def test_pdf_text_markdown_single_page_has_no_marker(tmp_path):
    path = tmp_path / "one.pdf"
    path.write_bytes(_pdf("Taufschein"))
    assert pdf_text_markdown(path) == "Taufschein"


def test_pdf_without_text_layer_or_damaged_has_no_text(tmp_path):
    scan = tmp_path / "scan.pdf"
    scan.write_bytes(_pdf(""))
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"%PDF-1.4 not really")
    assert pdf_text_markdown(scan) is None
    assert pdf_text_markdown(broken) is None


def test_attached_pdf_gets_its_text_layer(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(
        client, user, tree, _pdf("Geburtsurkunde"), "birth.pdf", "application/pdf"
    )

    assert _list_files(client, user, tree)[0]["has_text"] is True
    response = client.get(_text_url(tree, file_id), headers=auth(user))
    assert response.status_code == 200
    body = response.json()
    assert body["markdown"] == "Geburtsurkunde"
    assert body["source"] == "pdf_text"
    assert body["edited_by"] is None
    # The list stays light: it says whether a text exists, never the text.
    assert "markdown" not in _list_files(client, user, tree)[0]


def test_file_without_text_returns_null(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(client, user, tree, b"hello", "note.txt", "text/plain")

    assert _list_files(client, user, tree)[0]["has_text"] is False
    response = client.get(_text_url(tree, file_id), headers=auth(user))
    assert response.status_code == 200
    assert response.json() is None


def test_save_edit_and_clear_text(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(
        client, user, tree, _pdf("Geburtsurkunde"), "birth.pdf", "application/pdf"
    )

    saved = client.put(
        _text_url(tree, file_id),
        headers=auth(user),
        json={"markdown": "# Geburtsurkunde\n\nJohann *Schmidt*", "language": "de"},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["markdown"] == "# Geburtsurkunde\n\nJohann *Schmidt*"
    assert body["language"] == "de"
    assert body["source"] == "pdf_text"
    assert body["edited_by"] == user.id
    row = db.get(DocumentFileText, file_id)
    db.refresh(row)
    # The machine's original survives a person's correction.
    assert row.machine_markdown == "Geburtsurkunde"

    cleared = client.put(
        _text_url(tree, file_id), headers=auth(user), json={"markdown": "  "}
    )
    assert cleared.status_code == 200
    assert cleared.json() is None
    assert _list_files(client, user, tree)[0]["has_text"] is False


def test_manual_text_on_non_pdf(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(client, user, tree, b"\x89PNG", "scan.png", "image/png")

    saved = client.put(
        _text_url(tree, file_id), headers=auth(user), json={"markdown": "Lieber Hans,"}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["source"] == "manual"
    assert _list_files(client, user, tree)[0]["has_text"] is True


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
    file_id = _create_with_file(
        client, user, tree, _pdf("Geburtsurkunde"), "birth.pdf", "application/pdf"
    )
    response = client.delete(
        f"{API}/workspaces/{tree.id}/documents/doc-1/files/{file_id}", headers=auth(user)
    )
    assert response.status_code == 204
    db.expire_all()
    assert db.get(DocumentFileText, file_id) is None


def test_viewer_reads_but_cannot_edit(client, db, media_root):
    user, tree = _setup(db)
    file_id = _create_with_file(
        client, user, tree, _pdf("Geburtsurkunde"), "birth.pdf", "application/pdf"
    )
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
    file_id = _create_with_file(
        client, user, tree, _pdf("Geburtsurkunde"), "birth.pdf", "application/pdf"
    )
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
    file_id = _create_with_file(
        client, user, tree, _pdf("Geburtsurkunde"), "birth.pdf", "application/pdf"
    )
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
