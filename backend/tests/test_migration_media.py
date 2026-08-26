"""Tests for the v2 media-relocation phase (#995)."""

import json

from sqlalchemy import select

from app.core.config import settings
from app.db.base import utcnow_iso
from app.models import (
    ActivityLog,
    Document,
    DocumentFile,
    DocumentUpload,
    GalleryImage,
    Member,
    MigrationConflict,
    MigrationMapping,
    MigrationReport,
    MigrationRun,
    Workspace,
)
from app.models.identity_link import IdentityLink, IdentityLinkStatus
from app.services.media.storage import MEDIA_URL_PREFIX
from app.services.migration.converter import run_conversion
from app.services.migration.media import run_media_relocation
from tests.conftest import add_member, make_tree


def _make_run(db) -> MigrationRun:
    run = MigrationRun(
        source_version="1.10.2", target_version="2.0.0", phase="converting"
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def _wire_bridge(db, member_a: Member, member_b: Member) -> None:
    member_a.linked_workspace_id = member_b.workspace_id
    member_a.linked_member_id = member_b.id
    member_b.linked_workspace_id = member_a.workspace_id
    member_b.linked_member_id = member_a.id
    db.commit()


def _identity_link(db, member_a: Member, member_b: Member) -> IdentityLink:
    a_id, b_id = sorted((member_a.id, member_b.id))
    a_ws = member_a.workspace_id if a_id == member_a.id else member_b.workspace_id
    b_ws = member_b.workspace_id if a_id == member_a.id else member_a.workspace_id
    link = IdentityLink(
        member_a_id=a_id,
        member_b_id=b_id,
        workspace_a_id=a_ws,
        workspace_b_id=b_ws,
        status=IdentityLinkStatus.VERIFIED,
        verification_basis="legacy_dual_write_access",
    )
    db.add(link)
    db.commit()
    return link


def _url(workspace_id: str, filename: str) -> str:
    return f"{MEDIA_URL_PREFIX}/{workspace_id}/{filename}"


def _write(media_root, workspace_id: str, filename: str, data: bytes) -> str:
    tree_dir = media_root / workspace_id
    tree_dir.mkdir(parents=True, exist_ok=True)
    (tree_dir / filename).write_bytes(data)
    return _url(workspace_id, filename)


def test_media_relocation_rewrites_member_gallery_and_document_urls(
    db, owner, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    media_root = settings.media_root

    big = make_tree(db, owner, name="Big Tree")
    small = make_tree(db, owner, name="Small Tree")
    for i in range(3):
        add_member(db, big, f"big{i}")
    photo_url = _write(media_root, small.id, "photo.webp", b"member-photo")
    add_member(db, small, "small0", image_data=photo_url)
    bridge_big = add_member(db, big, "bridge-big", first_name="Anna")
    bridge_small = add_member(db, small, "bridge-small", first_name="Anna")
    _wire_bridge(db, bridge_big, bridge_small)
    _identity_link(db, bridge_big, bridge_small)

    gallery_url = _write(media_root, small.id, "gallery.webp", b"gallery-bytes")
    db.add(GalleryImage(id="gi1", workspace_id=small.id, image_data=gallery_url))

    now = utcnow_iso()
    doc_url = _write(media_root, small.id, "doc.pdf", b"document-bytes")
    db.add(Document(id="doc1", workspace_id=small.id, title="D", created_at=now, updated_at=now))
    db.add(
        DocumentFile(
            id="df1",
            workspace_id=small.id,
            document_id="doc1",
            kind="file",
            filename="doc.pdf",
            url=doc_url,
            mime_type="application/pdf",
            size=14,
            created_at=now,
        )
    )
    upload_url = _write(media_root, small.id, "staged.pdf", b"staged-bytes")
    db.add(
        DocumentUpload(
            id="up1",
            workspace_id=small.id,
            filename="staged.pdf",
            url=upload_url,
            mime_type="application/pdf",
            size=12,
            created_at=now,
        )
    )
    db.commit()

    run = _make_run(db)
    run_conversion(db, run)
    summary = run_media_relocation(db, run)

    assert summary.workspaces_relocated == 1
    assert db.get(Workspace, small.id) is None

    member = db.get(Member, "small0")
    assert member.image_data.startswith(f"{MEDIA_URL_PREFIX}/{big.id}/")
    assert not member.image_data.startswith(f"{MEDIA_URL_PREFIX}/{small.id}/")
    rel = member.image_data[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / rel).read_bytes() == b"member-photo"

    gallery = db.get(GalleryImage, "gi1")
    assert gallery.image_data.startswith(f"{MEDIA_URL_PREFIX}/{big.id}/")
    grel = gallery.image_data[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / grel).read_bytes() == b"gallery-bytes"

    doc_file = db.get(DocumentFile, "df1")
    assert doc_file.url.startswith(f"{MEDIA_URL_PREFIX}/{big.id}/")
    drel = doc_file.url[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / drel).read_bytes() == b"document-bytes"

    upload = db.get(DocumentUpload, "up1")
    assert upload.url.startswith(f"{MEDIA_URL_PREFIX}/{big.id}/")
    urel = upload.url[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / urel).read_bytes() == b"staged-bytes"

    # The source tree's media directory is gone; nothing was left behind.
    assert not (media_root / small.id).exists()


def test_media_relocation_rewrites_activity_log_trashed_media_snapshot(
    db, owner, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    media_root = settings.media_root

    big = make_tree(db, owner, name="Big")
    small = make_tree(db, owner, name="Small")
    add_member(db, big, "big0")
    add_member(db, big, "big1")
    add_member(db, small, "small0")
    bridge_big = add_member(db, big, "bridge-big")
    bridge_small = add_member(db, small, "bridge-small")
    _wire_bridge(db, bridge_big, bridge_small)
    _identity_link(db, bridge_big, bridge_small)

    trashed_url = _write(media_root, small.id, "trashed.webp", b"trashed-bytes")
    # Mirror gallery_delete_snapshot's trash move: the bytes live in .trash/
    # but the snapshot keeps the original, pre-trash live URL.
    trash_dir = media_root / small.id / ".trash"
    trash_dir.mkdir(parents=True)
    (media_root / small.id / "trashed.webp").rename(trash_dir / "trashed.webp")
    db.add(
        ActivityLog(
            id="log1",
            workspace_id=small.id,
            action="delete",
            target_type="gallery_image",
            target_id="gi-deleted",
            created_at=utcnow_iso(),
            details=json.dumps({"snapshot": {"trashed_media": [trashed_url]}}),
        )
    )
    db.commit()

    run = _make_run(db)
    run_conversion(db, run)
    run_media_relocation(db, run)

    log = db.get(ActivityLog, "log1")
    assert log.workspace_id == big.id
    details = json.loads(log.details)
    (new_url,) = details["snapshot"]["trashed_media"]
    assert new_url.startswith(f"{MEDIA_URL_PREFIX}/{big.id}/")
    rel = new_url[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / big.id / ".trash" / rel.split("/", 1)[1]).read_bytes() == (
        b"trashed-bytes"
    )


def test_media_relocation_rewrites_bridge_conflict_media(db, owner, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    media_root = settings.media_root

    tree_a = make_tree(db, owner, name="A")
    tree_b = make_tree(db, owner, name="B")
    photo_a = _write(media_root, tree_a.id, "a.webp", b"photo-a-bytes")
    photo_b = _write(media_root, tree_b.id, "b.webp", b"photo-b-bytes")
    bridge_a = add_member(db, tree_a, "bridge-a", first_name="Anna", image_data=photo_a)
    bridge_b = add_member(db, tree_b, "bridge-b", first_name="Anna", image_data=photo_b)
    _wire_bridge(db, bridge_a, bridge_b)
    _identity_link(db, bridge_a, bridge_b)

    run = _make_run(db)
    conv_summary = run_conversion(db, run)
    assert conv_summary.bridge_pairs_conflicted == 1

    survivor_id = tree_a.id if db.get(Workspace, tree_a.id) is not None else tree_b.id

    conflict = db.scalar(
        select(MigrationConflict).where(MigrationConflict.run_id == run.id)
    )
    before = conflict.conflicting_media[0]["image_data"]
    assert not before.startswith(f"{MEDIA_URL_PREFIX}/{survivor_id}/")

    run_media_relocation(db, run)

    db.refresh(conflict)
    after = conflict.conflicting_media[0]["image_data"]
    assert after.startswith(f"{MEDIA_URL_PREFIX}/{survivor_id}/")
    rel = after[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / rel).read_bytes() == b"photo-b-bytes"


def test_media_relocation_is_idempotent_on_replay(db, owner, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    media_root = settings.media_root

    big = make_tree(db, owner, name="Big")
    small = make_tree(db, owner, name="Small")
    add_member(db, big, "big0")
    add_member(db, big, "big1")
    photo_url = _write(media_root, small.id, "p.webp", b"p-bytes")
    add_member(db, small, "small0", image_data=photo_url)
    bridge_big = add_member(db, big, "bridge-big")
    bridge_small = add_member(db, small, "bridge-small")
    _wire_bridge(db, bridge_big, bridge_small)
    _identity_link(db, bridge_big, bridge_small)

    run = _make_run(db)
    run_conversion(db, run)
    first = run_media_relocation(db, run)
    assert first.workspaces_relocated == 1

    second = run_media_relocation(db, run)
    assert second.workspaces_relocated == 0

    member = db.get(Member, "small0")
    rel = member.image_data[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / rel).read_bytes() == b"p-bytes"


def test_media_relocation_populates_report_media_verification(
    db, owner, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    media_root = settings.media_root

    big = make_tree(db, owner, name="Big")
    small = make_tree(db, owner, name="Small")
    add_member(db, big, "big0")
    add_member(db, big, "big1")
    photo_url = _write(media_root, small.id, "p.webp", b"p-bytes")
    add_member(db, small, "small0", image_data=photo_url)
    bridge_big = add_member(db, big, "bridge-big")
    bridge_small = add_member(db, small, "bridge-small")
    _wire_bridge(db, bridge_big, bridge_small)
    _identity_link(db, bridge_big, bridge_small)

    run = _make_run(db)
    run_conversion(db, run)
    summary = run_media_relocation(db, run)
    assert summary.reports_updated == 1

    mapping = db.scalar(
        select(MigrationMapping).where(
            MigrationMapping.run_id == run.id, MigrationMapping.source_workspace_id == small.id
        )
    )
    report = db.scalar(
        select(MigrationReport).where(
            MigrationReport.run_id == run.id, MigrationReport.owner_user_id == owner.id
        )
    )
    assert small.id in report.media_verification
    assert report.media_verification[small.id]["files_moved"] == 1
    assert report.media_verification[small.id]["verified"] is True
    assert "owner_usage_after_bytes" in report.media_verification
    assert mapping.target_workspace_id == big.id
