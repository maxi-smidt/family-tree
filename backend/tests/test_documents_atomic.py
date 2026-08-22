"""Atomicity of the staged-upload + composite document save (issue #665).

Files are streamed to a staging area first, then attached by a single
transactional ``PUT /documents/{id}`` alongside the metadata, people, removals
and renames. These tests inject a failure at every boundary (validation,
quota, DB commit) and replay a request, asserting the two invariants the issue
requires: a failed edit leaves the previous valid document intact, and no
orphan files are ever left behind.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.core.config import settings
from app.models import DocumentUpload
from app.services.documents import document_service
from tests.conftest import API, add_member, auth, make_tree, make_user

_HELLO = b"hello"
_WORLD = b"world"


@pytest.fixture()
def media_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return settings.media_root


def _setup(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="A")
    add_member(db, tree, "m2", first_name="B")
    return user, tree


def _stage(client, user, tree, content=_HELLO, filename="scan.txt", checksum=None):
    data = {"filename": filename}
    if checksum is not None:
        data["checksum"] = checksum
    return client.post(
        f"{API}/trees/{tree.id}/documents/uploads",
        headers=auth(user),
        data=data,
        files={"file": (filename, content, "text/plain")},
    )


def _save(client, user, tree, doc_id, **body):
    payload = {"title": "Doc", "member_ids": ["m1"], **body}
    return client.put(
        f"{API}/trees/{tree.id}/documents/{doc_id}",
        headers=auth(user),
        json=payload,
    )


def _media_files(media_root, tree_id):
    """Committed/staged files in the tree dir (excluding in-flight temp files)."""
    tree_dir = media_root / tree_id
    if not tree_dir.is_dir():
        return []
    return [
        p
        for p in tree_dir.iterdir()
        if p.is_file() and not p.name.startswith(".")
    ]


def _rel(url):
    return url[len("/api/media/") :]


def _docs(client, user, tree):
    return client.get(
        f"{API}/trees/{tree.id}/documents", headers=auth(user)
    ).json()


# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------


def test_stage_upload_persists_bytes_and_returns_metadata(client, db, media_root):
    user, tree = _setup(db)
    res = _stage(client, user, tree)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["filename"] == "scan.txt"
    assert body["mime_type"] == "text/plain"
    assert body["size"] == len(_HELLO)
    assert len(_media_files(media_root, tree.id)) == 1


def test_stage_rejects_bad_checksum(client, db, media_root):
    user, tree = _setup(db)
    res = _stage(client, user, tree, checksum="0" * 64)
    assert res.status_code == 400
    # The rejected upload leaves nothing on disk.
    assert _media_files(media_root, tree.id) == []


def test_stage_quota_rejection_leaves_no_orphan(client, db, media_root):
    user, tree = _setup(db)
    user.media_quota_bytes = 1
    db.commit()

    res = _stage(client, user, tree)
    assert res.status_code == 413
    assert res.json()["detail"] == "quota_exceeded_media"
    assert _media_files(media_root, tree.id) == []
    assert db.query(DocumentUpload).count() == 0


# ---------------------------------------------------------------------------
# Composite save — happy paths
# ---------------------------------------------------------------------------


def test_save_attaches_upload_link_and_members(client, db, media_root):
    user, tree = _setup(db)
    upload_id = _stage(client, user, tree).json()["id"]

    res = _save(
        client, user, tree, "doc-1",
        title="Birth record",
        member_ids=["m1", "m2"],
        attached_upload_ids=[upload_id],
        added_links=[
            {"id": "link-1", "url": "https://example.com/rec", "filename": "Ref"}
        ],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["title"] == "Birth record"
    assert set(body["member_ids"]) == {"m1", "m2"}
    assert {f["kind"] for f in body["files"]} == {"file", "link"}
    file_row = next(f for f in body["files"] if f["kind"] == "file")
    assert (media_root / _rel(file_row["url"])).exists()
    # The staging row is consumed; the bytes now belong to the document.
    assert db.query(DocumentUpload).count() == 0
    assert len(_media_files(media_root, tree.id)) == 1


def test_save_replaces_file_staging_before_removal(client, db, media_root):
    user, tree = _setup(db)
    old_id = _stage(client, user, tree, content=_HELLO).json()["id"]
    _save(client, user, tree, "doc-1", attached_upload_ids=[old_id])
    old_url = _docs(client, user, tree)[0]["files"][0]["url"]

    new_id = _stage(client, user, tree, content=_WORLD, filename="new.txt").json()["id"]
    res = _save(
        client, user, tree, "doc-1",
        attached_upload_ids=[new_id],
        removed_file_ids=[old_id],
    )
    assert res.status_code == 200, res.text
    files = res.json()["files"]
    assert [f["id"] for f in files] == [new_id]
    assert not (media_root / _rel(old_url)).exists()  # old bytes removed
    assert (media_root / _rel(files[0]["url"])).exists()  # new bytes present
    assert len(_media_files(media_root, tree.id)) == 1


def test_save_renames_and_removes_without_touching_kept_files(client, db, media_root):
    user, tree = _setup(db)
    keep_id = _stage(client, user, tree, filename="keep.txt").json()["id"]
    drop_id = _stage(client, user, tree, content=_WORLD, filename="drop.txt").json()["id"]
    _save(client, user, tree, "doc-1", attached_upload_ids=[keep_id, drop_id])

    res = _save(
        client, user, tree, "doc-1",
        removed_file_ids=[drop_id],
        renamed_files=[{"id": keep_id, "filename": "renamed.txt"}],
    )
    assert res.status_code == 200, res.text
    files = res.json()["files"]
    assert len(files) == 1
    assert files[0]["id"] == keep_id
    assert files[0]["filename"] == "renamed.txt"
    assert len(_media_files(media_root, tree.id)) == 1


def test_attaching_unknown_upload_is_skipped(client, db, media_root):
    user, tree = _setup(db)
    res = _save(client, user, tree, "doc-1", attached_upload_ids=["nope"])
    assert res.status_code == 200
    assert res.json()["files"] == []


# ---------------------------------------------------------------------------
# Idempotent retries
# ---------------------------------------------------------------------------


def test_replayed_save_is_idempotent(client, db, media_root):
    user, tree = _setup(db)
    upload_id = _stage(client, user, tree).json()["id"]
    body = dict(
        attached_upload_ids=[upload_id],
        added_links=[{"id": "link-1", "url": "https://example.com", "filename": None}],
    )

    first = _save(client, user, tree, "doc-1", **body)
    second = _save(client, user, tree, "doc-1", **body)

    assert first.status_code == 200
    assert second.status_code == 200
    docs = _docs(client, user, tree)
    assert len(docs) == 1  # no duplicate document
    assert len(docs[0]["files"]) == 2  # no duplicate file / link rows
    assert len(_media_files(media_root, tree.id)) == 1  # no duplicate bytes


def test_removing_an_already_gone_file_is_a_noop(client, db, media_root):
    user, tree = _setup(db)
    upload_id = _stage(client, user, tree).json()["id"]
    _save(client, user, tree, "doc-1", attached_upload_ids=[upload_id])
    _save(client, user, tree, "doc-1", removed_file_ids=[upload_id])
    res = _save(client, user, tree, "doc-1", removed_file_ids=[upload_id])
    assert res.status_code == 200
    assert res.json()["files"] == []


# ---------------------------------------------------------------------------
# Failure boundaries — previous document stays intact, no orphan files
# ---------------------------------------------------------------------------


def test_invalid_link_leaves_previous_document_intact(client, db, media_root):
    user, tree = _setup(db)
    _save(client, user, tree, "doc-1", title="Doc")

    res = _save(
        client, user, tree, "doc-1",
        title="Changed",
        added_links=[{"id": "bad", "url": "javascript:alert(1)", "filename": None}],
    )
    assert res.status_code == 400

    doc = _docs(client, user, tree)[0]
    assert doc["title"] == "Doc"  # metadata change rolled back with the rest
    assert doc["files"] == []


def test_cross_tree_document_id_rejected(client, db):
    user, tree = _setup(db)
    other = make_tree(db, user, "Other")
    add_member(db, other, "o1", first_name="O")
    _save(client, user, tree, "doc-1")

    res = client.put(
        f"{API}/trees/{other.id}/documents/doc-1",
        headers=auth(user),
        json={"title": "X", "member_ids": ["o1"]},
    )
    assert res.status_code == 404


def test_db_commit_failure_compensates_and_keeps_prior_document(
    client, db, media_root, monkeypatch
):
    user, tree = _setup(db)
    old_id = _stage(client, user, tree, content=_HELLO).json()["id"]
    _save(client, user, tree, "doc-1", attached_upload_ids=[old_id])
    old_url = _docs(client, user, tree)[0]["files"][0]["url"]

    new_id = _stage(client, user, tree, content=_WORLD, filename="new.txt").json()["id"]
    assert len(_media_files(media_root, tree.id)) == 2  # old (attached) + new (staged)

    def _boom(_db):
        raise RuntimeError("commit boom")

    monkeypatch.setattr(document_service, "_run_commit", _boom)

    with pytest.raises(RuntimeError, match="commit boom"):
        _save(
            client, user, tree, "doc-1",
            title="Changed",
            attached_upload_ids=[new_id],
            removed_file_ids=[old_id],
        )

    monkeypatch.undo()  # restore commit so assertions read committed state

    doc = _docs(client, user, tree)[0]
    assert doc["title"] == "Doc"  # rolled back
    assert [f["id"] for f in doc["files"]] == [old_id]  # old file still attached
    assert (media_root / _rel(old_url)).exists()  # old bytes intact
    # The new upload is still staged (row + bytes) for a retry, not orphaned.
    assert db.get(DocumentUpload, new_id) is not None
    assert len(_media_files(media_root, tree.id)) == 2


# ---------------------------------------------------------------------------
# Reaping abandoned staged uploads
# ---------------------------------------------------------------------------


def test_stale_uploads_are_reaped_on_next_stage(client, db, media_root):
    user, tree = _setup(db)
    stale_id = _stage(client, user, tree, filename="stale.txt").json()["id"]
    stale_url = db.get(DocumentUpload, stale_id).url
    assert (media_root / _rel(stale_url)).exists()

    # Backdate it past the TTL so the next stage reclaims it.
    stale = db.get(DocumentUpload, stale_id)
    stale.created_at = (
        datetime.now(UTC)
        - timedelta(seconds=document_service.STALE_UPLOAD_TTL_SECONDS + 3600)
    ).isoformat()
    db.commit()

    fresh_id = _stage(client, user, tree, filename="fresh.txt").json()["id"]

    db.expire_all()
    assert db.get(DocumentUpload, stale_id) is None  # stale row reaped
    assert not (media_root / _rel(stale_url)).exists()  # stale bytes reaped
    assert db.get(DocumentUpload, fresh_id) is not None
    assert len(_media_files(media_root, tree.id)) == 1  # only the fresh upload
