"""Integration coverage for encrypted full-instance backup and restore."""

import base64
import hashlib
import shutil

import pytest
from sqlalchemy import delete, func, inspect, select

from app.core.config import settings
from app.db.base import Base
from app.models import (
    AppSetting,
    BackgroundJob,
    Document,
    DocumentFile,
    DocumentUpload,
    Friendship,
    GeocodeCache,
    LegalDocumentVersion,
    Member,
    QualityIssueDismissal,
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
    VirtualViewSource,
    VirtualViewUserState,
    WorkspaceInvitation,
    WorkspaceUserState,
)
from app.services.crypto_export import encrypt_bundle
from app.services.system.backups import backup_service, streaming_archive
from tests.conftest import add_member, make_tree, make_user


def test_backup_models_cover_every_registered_model():
    """Every model registered on Base is either backed up or explicitly excluded.

    Guards against the class of bug reported in #871: a new durable model
    landing without anyone deciding whether it belongs in an instance backup.
    """
    registered = {mapper.class_ for mapper in Base.registry.mappers}
    accounted_for = set(backup_service.BACKUP_MODELS) | set(
        backup_service.BACKUP_EXCLUDED_MODELS
    )
    assert registered == accounted_for


def test_restore_ignores_legacy_feature_metadata(db, tmp_path, monkeypatch):
    """Old backups do not recreate removed flags or their app settings."""
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    media_root = tmp_path / "media"
    media_root.mkdir()
    (media_root / "keep.txt").write_text("keep")
    backup_path = tmp_path / "legacy.ftbackup"

    bundle = backup_service._collect_bundle(db).model_dump()
    settings_rows = bundle["tables"][AppSetting.__tablename__]
    settings_rows.extend(
        [
            {"key": "feature.gallery", "value": "off"},
            {"key": "instance_name", "value": "Family Workspace"},
        ]
    )
    bundle["manifest"]["table_row_counts"][AppSetting.__tablename__] = len(settings_rows)
    bundle["tables"]["feature_flag_overrides"] = [
        {"feature": "gallery", "user_id": "user-1"}
    ]
    bundle["manifest"]["table_row_counts"]["feature_flag_overrides"] = 1
    backup_path.write_bytes(encrypt_bundle(bundle, None))

    backup_service.restore_backup_file(
        db, backup_path, replace=True, media_root=media_root
    )

    assert db.get(AppSetting, "feature.gallery") is None
    assert db.get(AppSetting, "instance_name").value == "Family Workspace"
    assert "feature_flag_overrides" not in inspect(db.get_bind()).get_table_names()
    assert (media_root / "keep.txt").read_text() == "keep"


def test_backup_restores_full_instance_and_media(db, tmp_path, monkeypatch):
    """A verified backup restores durable rows and original media bytes."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")

    admin = make_user(db, "admin", is_admin=True)
    friend = make_user(db, "friend")
    tree = make_tree(db, admin)
    first = add_member(db, tree, "member-1", first_name="Ada")
    second = add_member(db, tree, "member-2", first_name="Grace")
    first.linked_member_id = second.id
    second.linked_member_id = first.id
    db.add(Friendship(requester_id=admin.id, addressee_id=friend.id))
    db.add(
        WorkspaceInvitation(
            id="invite-1",
            workspace_id=tree.id,
            token="invite-token",
            created_by=admin.id,
        )
    )
    db.add(
        GeocodeCache(
            query="Vienna",
            lat=48.2,
            lon=16.37,
            display_name="Vienna",
            updated_at="now",
        )
    )
    db.add(
        BackgroundJob(
            id="job-1",
            user_id=admin.id,
            type="import",
            status="done",
            created_at="now",
            updated_at="now",
        )
    )
    db.add(
        LegalDocumentVersion(
            id="legal-1",
            document_type="terms",
            locale="en",
            version="1",
            body="Terms",
            content_hash="a" * 64,
            published_at="now",
        )
    )
    db.add(
        QualityIssueDismissal(
            id="dismissal-1",
            workspace_id=tree.id,
            issue_id="issue-1",
            issue_type="missing_parent",
            member_ids='["member-1"]',
            dismissed_by_id=admin.id,
        )
    )
    document = Document(
        id="document-1",
        workspace_id=tree.id,
        title="Certificate",
        created_at="now",
        updated_at="now",
    )
    db.add(document)
    db.add(
        DocumentFile(
            id="file-1",
            workspace_id=tree.id,
            document_id=document.id,
            kind="file",
            filename="certificate.pdf",
            url=f"{settings.API_PREFIX}/media/{tree.id}/certificate.pdf",
            mime_type="application/pdf",
            size=12,
            created_at="now",
        )
    )
    view = VirtualView(id="vv-1", name="Compare", owner_id=admin.id, created_at="now")
    db.add(view)
    db.add(VirtualViewSource(view_id=view.id, position=0, workspace_id=tree.id))
    db.add(VirtualViewMemberMatch(view_id=view.id, member_id=first.id, group_id="group"))
    db.add(
        VirtualViewPosition(view_id=view.id, node_id=first.id, position_x=1, position_y=2)
    )
    db.commit()

    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "certificate.pdf").write_bytes(b"full backup\x00")
    (tree_media / "originals").mkdir()
    (tree_media / "originals" / "certificate.original.pdf").write_bytes(b"original")

    record = backup_service.create_backup(db, actor=admin)
    assert record.status == "success"
    assert record.filename is not None
    backup_path = backup_service.BACKUP_DIR / record.filename
    manifest = backup_service.verify_archive(backup_path)
    assert set(manifest["table_row_counts"]) == {
        model.__tablename__ for model in backup_service.BACKUP_MODELS
    }
    assert manifest["table_row_counts"]["friendships"] == 1
    assert manifest["table_row_counts"]["workspace_invitations"] == 1
    assert manifest["table_row_counts"]["quality_issue_dismissals"] == 1
    assert manifest["table_row_counts"]["geocode_cache"] == 1

    # This simulates a blank-instance recovery in the same database/volume.
    backup_service.restore_backup_file(
        db, backup_path, replace=True, media_root=media_root
    )

    assert db.get(Member, first.id).linked_member_id == second.id
    assert db.get(Member, second.id).linked_member_id == first.id
    assert db.get(WorkspaceInvitation, "invite-1") is not None
    assert db.get(QualityIssueDismissal, "dismissal-1") is not None
    assert db.get(GeocodeCache, "Vienna") is not None
    assert db.get(BackgroundJob, "job-1") is not None
    assert db.get(DocumentFile, "file-1") is not None
    assert db.get(VirtualView, "vv-1") is not None
    assert (tree_media / "certificate.pdf").read_bytes() == b"full backup\x00"
    original_path = tree_media / "originals" / "certificate.original.pdf"
    assert original_path.read_bytes() == b"original"

    # The journal and any staging/rollback directories are cleaned up once
    # the restore has fully committed.
    assert not backup_service._journal_path(media_root).is_file()
    assert not list(media_root.parent.glob(f"{media_root.name}.restore-*"))


def test_backup_restores_staged_document_upload(db, tmp_path, monkeypatch):
    """A staged, not-yet-attached upload survives backup/restore intact.

    Without the ``DocumentUpload`` row, a restore would recreate the staged
    bytes with no bookkeeping to ever claim or reap them (#871).
    """
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    upload_url = f"{settings.API_PREFIX}/media/{tree.id}/staged.pdf"
    db.add(
        DocumentUpload(
            id="upload-1",
            workspace_id=tree.id,
            filename="staged.pdf",
            url=upload_url,
            mime_type="application/pdf",
            size=4,
            created_at="now",
        )
    )
    db.commit()

    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "staged.pdf").write_bytes(b"stag")

    bundle = backup_service._collect_bundle(db).model_dump()
    backup_service.validate_bundle(bundle)

    backup_service.restore_bundle(db, bundle, replace=True, media_root=media_root)

    restored = db.get(DocumentUpload, "upload-1")
    assert restored is not None
    assert restored.workspace_id == tree.id
    assert (tree_media / "staged.pdf").read_bytes() == b"stag"


def test_restore_backup_file_accepts_legacy_bundle_missing_document_uploads(
    db, tmp_path, monkeypatch
):
    """A v2 backup taken before #871 (no document_uploads table) still restores.

    Simulates a backup file written by a pre-#871 build: the same version
    number, but with the table and its manifest count absent entirely rather
    than present-and-empty.
    """
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    backup_path = tmp_path / "legacy.ftbackup"

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    db.commit()

    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "photo.jpg").write_bytes(b"photo-bytes")

    bundle = backup_service._collect_bundle(db).model_dump()
    del bundle["tables"]["document_uploads"]
    del bundle["manifest"]["table_row_counts"]["document_uploads"]
    backup_path.write_bytes(encrypt_bundle(bundle, None))

    for model in reversed(backup_service.BACKUP_MODELS):
        db.execute(delete(model))
    db.commit()
    shutil.rmtree(media_root, ignore_errors=True)

    backup_service.restore_backup_file(
        db, backup_path, replace=False, media_root=media_root
    )

    assert db.scalar(select(func.count()).select_from(DocumentUpload)) == 0
    assert (tree_media / "photo.jpg").read_bytes() == b"photo-bytes"


def test_restore_backup_file_migrates_legacy_last_opened(db, tmp_path, monkeypatch):
    """A pre-#878 backup still has ``last_opened`` inline on its ``workspaces`` /
    ``virtual_views`` rows (dropped from those tables by the #878 migration)
    and lacks ``tree_user_states`` / ``virtual_view_user_states`` entirely.

    ``bulk_insert_mappings`` silently ignores unmapped dict keys, so without
    recovering it first, restoring such a backup would drop that data. It
    must land as an owner-attributed row in the new tables instead.
    """
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    backup_path = tmp_path / "legacy.ftbackup"

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    view = VirtualView(name="Legacy View", owner_id=admin.id)
    db.add(view)
    db.commit()

    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "photo.jpg").write_bytes(b"photo-bytes")

    bundle = backup_service._collect_bundle(db).model_dump()
    # Simulate the pre-#878 row shape: last_opened still inline, and the new
    # per-user state tables absent entirely (as if this build never had them).
    bundle["tables"]["workspaces"][0]["last_opened"] = "2026-01-01T00:00:00+00:00"
    bundle["tables"]["virtual_views"][0]["last_opened"] = "2026-02-02T00:00:00+00:00"
    del bundle["tables"]["workspace_user_states"]
    del bundle["manifest"]["table_row_counts"]["workspace_user_states"]
    del bundle["tables"]["virtual_view_user_states"]
    del bundle["manifest"]["table_row_counts"]["virtual_view_user_states"]
    backup_path.write_bytes(encrypt_bundle(bundle, None))

    for model in reversed(backup_service.BACKUP_MODELS):
        db.execute(delete(model))
    db.commit()
    shutil.rmtree(media_root, ignore_errors=True)

    backup_service.restore_backup_file(
        db, backup_path, replace=False, media_root=media_root
    )

    tree_state = db.get(WorkspaceUserState, (tree.id, admin.id))
    assert tree_state is not None
    assert tree_state.last_opened == "2026-01-01T00:00:00+00:00"

    view_state = db.get(VirtualViewUserState, (view.id, admin.id))
    assert view_state is not None
    assert view_state.last_opened == "2026-02-02T00:00:00+00:00"


def test_backup_validation_rejects_changed_media(db, tmp_path, monkeypatch):
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    add_member(db, tree, "member-1")
    path = media_root / tree.id / "photo.jpg"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"original")

    bundle = backup_service._collect_bundle(db).model_dump()
    bundle["media"][0]["data"] = "Y2hhbmdlZA=="

    with pytest.raises(backup_service.BackupValidationError):
        backup_service.validate_bundle(bundle)


def test_restore_blank_target_verifies_and_cleans_up(db, tmp_path, monkeypatch):
    """A restore into an already-blank target still verifies and self-cleans."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    add_member(db, tree, "member-1", first_name="Ada")
    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "photo.jpg").write_bytes(b"photo-bytes")

    bundle = backup_service._collect_bundle(db).model_dump()
    backup_service.validate_bundle(bundle)

    for model in reversed(backup_service.BACKUP_MODELS):
        db.execute(delete(model))
    db.commit()
    shutil.rmtree(media_root)

    backup_service.restore_bundle(db, bundle, replace=False, media_root=media_root)

    assert db.get(Member, "member-1") is not None
    assert (tree_media / "photo.jpg").read_bytes() == b"photo-bytes"
    assert not backup_service._journal_path(media_root).is_file()
    assert not list(media_root.parent.glob(f"{media_root.name}.restore-*"))


def test_restore_rejects_media_corrupted_after_staging(db, tmp_path, monkeypatch):
    """Disk corruption between staging and the swap is caught, not installed."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    add_member(db, tree, "member-1")
    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "photo.jpg").write_bytes(b"original")

    bundle = backup_service._collect_bundle(db).model_dump()

    original_write = backup_service._write_staged_media

    def _write_then_corrupt(media, media_root_arg, restore_id):
        staging = original_write(media, media_root_arg, restore_id)
        next(staging.rglob("photo.jpg")).write_bytes(b"corrupted")
        return staging

    monkeypatch.setattr(backup_service, "_write_staged_media", _write_then_corrupt)

    with pytest.raises(backup_service.BackupValidationError):
        backup_service.restore_bundle(db, bundle, replace=True, media_root=media_root)

    assert (tree_media / "photo.jpg").read_bytes() == b"original"
    assert db.get(Member, "member-1") is not None
    assert not backup_service._journal_path(media_root).is_file()
    assert not list(media_root.parent.glob(f"{media_root.name}.restore-*"))


def test_restore_replace_failure_before_swap_preserves_original(
    db, tmp_path, monkeypatch
):
    """A failure while validating the restored rows never touches media."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    add_member(db, tree, "member-1")
    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "photo.jpg").write_bytes(b"original")

    bundle = backup_service._collect_bundle(db).model_dump()

    def _boom(*_args, **_kwargs):
        raise RuntimeError("simulated verification failure")

    monkeypatch.setattr(backup_service, "_verify_database_counts", _boom)

    with pytest.raises(RuntimeError):
        backup_service.restore_bundle(db, bundle, replace=True, media_root=media_root)

    assert db.get(Member, "member-1") is not None
    assert (tree_media / "photo.jpg").read_bytes() == b"original"
    assert not backup_service._journal_path(media_root).is_file()
    assert not list(media_root.parent.glob(f"{media_root.name}.restore-*"))


def test_restore_replace_failure_during_swap_reverts_media(db, tmp_path, monkeypatch):
    """A failure between the two swap renames is fully unwound."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    add_member(db, tree, "member-1")
    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "photo.jpg").write_bytes(b"original")

    bundle = backup_service._collect_bundle(db).model_dump()

    original_rename = backup_service._rename_dir
    calls = {"n": 0}

    def _flaky_rename(src, dest):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("simulated disk failure")
        return original_rename(src, dest)

    monkeypatch.setattr(backup_service, "_rename_dir", _flaky_rename)

    with pytest.raises(OSError):
        backup_service.restore_bundle(db, bundle, replace=True, media_root=media_root)

    assert (tree_media / "photo.jpg").read_bytes() == b"original"
    assert db.get(Member, "member-1") is not None
    assert not backup_service._journal_path(media_root).is_file()
    assert not list(media_root.parent.glob(f"{media_root.name}.restore-*"))


def test_restore_replace_failure_before_commit_reverts_swap(db, tmp_path, monkeypatch):
    """A failure committing the transaction rolls the already-swapped media back."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    add_member(db, tree, "member-1")
    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "photo.jpg").write_bytes(b"original")

    bundle = backup_service._collect_bundle(db).model_dump()

    def _boom():
        raise RuntimeError("simulated commit failure")

    monkeypatch.setattr(db, "commit", _boom)

    with pytest.raises(RuntimeError):
        backup_service.restore_bundle(db, bundle, replace=True, media_root=media_root)

    assert (tree_media / "photo.jpg").read_bytes() == b"original"
    assert db.get(Member, "member-1") is not None
    assert not backup_service._journal_path(media_root).is_file()
    assert not list(media_root.parent.glob(f"{media_root.name}.restore-*"))


def test_restore_crash_after_commit_is_reconciled_forward(db, tmp_path, monkeypatch):
    """A crash after commit but before cleanup leaves the new instance intact;
    startup reconciliation finishes the cleanup rather than reverting it."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")

    # Build the incoming backup ("new" content) from a throwaway state.
    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    add_member(db, tree, "new-member", first_name="New")
    new_tree_media = media_root / tree.id
    new_tree_media.mkdir(parents=True)
    (new_tree_media / "new.jpg").write_bytes(b"new-bytes")
    bundle = backup_service._collect_bundle(db).model_dump()
    backup_service.validate_bundle(bundle)

    # Replace with a different "old" live state that the restore will overwrite.
    for model in reversed(backup_service.BACKUP_MODELS):
        db.execute(delete(model))
    db.commit()
    shutil.rmtree(media_root)
    old_admin = make_user(db, "old-admin", is_admin=True)
    old_tree = make_tree(db, old_admin)
    add_member(db, old_tree, "old-member", first_name="Old")
    old_tree_media = media_root / old_tree.id
    old_tree_media.mkdir(parents=True)
    (old_tree_media / "old.jpg").write_bytes(b"old-bytes")

    def _boom(*_args, **_kwargs):
        raise OSError("simulated crash during cleanup")

    monkeypatch.setattr(backup_service, "_finalize_restore", _boom)

    with pytest.raises(OSError):
        backup_service.restore_bundle(db, bundle, replace=True, media_root=media_root)

    # The swap and commit already landed before the simulated crash.
    assert db.get(Member, "new-member") is not None
    assert db.get(Member, "old-member") is None
    assert (media_root / tree.id / "new.jpg").read_bytes() == b"new-bytes"
    assert not (media_root / old_tree.id).exists()

    journal_path = backup_service._journal_path(media_root)
    assert journal_path.is_file()

    backup_service.reconcile_interrupted_restore(db, media_root=media_root)

    assert not journal_path.is_file()
    assert not list(media_root.parent.glob(f"{media_root.name}.restore-*"))
    assert db.get(Member, "new-member") is not None
    assert (media_root / tree.id / "new.jpg").read_bytes() == b"new-bytes"


def test_reconcile_rolls_back_uncommitted_swap(db, tmp_path, monkeypatch):
    """A journal with no matching commit marker is rolled back to the original."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)

    tree_media = media_root / "tree-1"
    tree_media.mkdir(parents=True)
    (tree_media / "old.jpg").write_bytes(b"old-bytes")

    restore_id = "restore-1"
    staging = media_root.with_name(f"{media_root.name}.restore-stage-{restore_id}")
    (staging / "tree-1").mkdir(parents=True)
    (staging / "tree-1" / "new.jpg").write_bytes(b"new-bytes")
    rollback = media_root.with_name(f"{media_root.name}.restore-rollback-{restore_id}")
    journal_path = backup_service._journal_path(media_root)

    backup_service._write_journal(
        journal_path,
        {
            "id": restore_id,
            "media_root": str(media_root),
            "staging": str(staging),
            "rollback": str(rollback),
            "created_at": "now",
        },
    )
    backup_service._swap_media(media_root, staging, rollback)
    # No RestoreMarker row committed here — simulates a crash before commit.

    assert (media_root / "tree-1" / "new.jpg").is_file()

    backup_service.reconcile_interrupted_restore(db, media_root=media_root)

    assert (media_root / "tree-1" / "old.jpg").read_bytes() == b"old-bytes"
    assert not (media_root / "tree-1" / "new.jpg").exists()
    assert not journal_path.is_file()
    assert not staging.exists()
    assert not rollback.exists()


def test_reconcile_sweeps_orphaned_staging_dir_with_no_journal(db, tmp_path, monkeypatch):
    """A staging dir orphaned before any journal was ever written is swept."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    media_root.mkdir(parents=True)
    (media_root / "keep.jpg").write_bytes(b"keep")

    orphan = media_root.with_name(f"{media_root.name}.restore-stage-orphan")
    orphan.mkdir(parents=True)
    (orphan / "leftover.jpg").write_bytes(b"leftover")

    backup_service.reconcile_interrupted_restore(db, media_root=media_root)

    assert (media_root / "keep.jpg").is_file()
    assert not orphan.exists()


def test_reconcile_preserves_original_media_when_swap_never_started(
    db, tmp_path, monkeypatch
):
    """A journal written just before the swap, but a crash before either
    rename runs, must not delete the still-original media root."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)

    tree_media = media_root / "tree-1"
    tree_media.mkdir(parents=True)
    (tree_media / "old.jpg").write_bytes(b"old-bytes")

    restore_id = "restore-1"
    staging = media_root.with_name(f"{media_root.name}.restore-stage-{restore_id}")
    (staging / "tree-1").mkdir(parents=True)
    (staging / "tree-1" / "new.jpg").write_bytes(b"new-bytes")
    rollback = media_root.with_name(f"{media_root.name}.restore-rollback-{restore_id}")
    journal_path = backup_service._journal_path(media_root)

    backup_service._write_journal(
        journal_path,
        {
            "id": restore_id,
            "media_root": str(media_root),
            "staging": str(staging),
            "rollback": str(rollback),
            "created_at": "now",
        },
    )
    # No _swap_media call and no RestoreMarker: simulates a crash between
    # writing the journal and the first rename ever running.

    backup_service.reconcile_interrupted_restore(db, media_root=media_root)

    assert (tree_media / "old.jpg").read_bytes() == b"old-bytes"
    assert not journal_path.is_file()
    assert not staging.exists()
    assert not rollback.exists()


def test_reconcile_leaves_directories_alone_on_unreadable_journal(
    db, tmp_path, monkeypatch
):
    """A corrupt journal must not lead to guessing and sweeping away the
    rollback directory, which may be the only surviving copy of the original
    media."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)

    restore_id = "restore-1"
    staging = media_root.with_name(f"{media_root.name}.restore-stage-{restore_id}")
    staging.mkdir(parents=True)
    (staging / "new.jpg").write_bytes(b"new-bytes")
    rollback = media_root.with_name(f"{media_root.name}.restore-rollback-{restore_id}")
    rollback.mkdir(parents=True)
    (rollback / "old.jpg").write_bytes(b"only-surviving-copy")

    journal_path = backup_service._journal_path(media_root)
    journal_path.write_text("{not valid json")

    backup_service.reconcile_interrupted_restore(db, media_root=media_root)

    assert journal_path.is_file()
    assert (staging / "new.jpg").read_bytes() == b"new-bytes"
    assert (rollback / "old.jpg").read_bytes() == b"only-surviving-copy"


# --- Streaming (format version 3) archive -----------------------------------


def test_create_backup_writes_streaming_archive(db, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")
    admin = make_user(db, "admin", is_admin=True)

    record = backup_service.create_backup(db, actor=admin)

    assert record.status == "success"
    backup_path = backup_service.BACKUP_DIR / record.filename
    magic_len = len(streaming_archive.MAGIC)
    assert backup_path.read_bytes()[:magic_len] == streaming_archive.MAGIC
    # The temp file used for the atomic install never lingers once installed.
    assert not list(backup_service.BACKUP_DIR.glob(".*.tmp"))


def test_restore_backup_file_dispatches_legacy_bundle_by_header(
    db, tmp_path, monkeypatch
):
    """A pre-existing format version 2 file still restores through the same
    entry point new streaming archives use."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    add_member(db, tree, "member-1")

    bundle = backup_service._collect_bundle(db).model_dump()
    backup_path = tmp_path / "legacy.ftbackup"
    backup_path.write_bytes(encrypt_bundle(bundle, None))
    assert not backup_service._is_streaming_archive(backup_path)

    for model in reversed(backup_service.BACKUP_MODELS):
        db.execute(delete(model))
    db.commit()
    shutil.rmtree(media_root, ignore_errors=True)

    backup_service.restore_backup_file(
        db, backup_path, replace=False, media_root=media_root
    )

    assert db.get(Member, "member-1") is not None


def test_verify_archive_detects_tampered_installed_bytes(db, tmp_path, monkeypatch):
    """Self-verify catches corruption of the file already written to disk."""
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")
    admin = make_user(db, "admin", is_admin=True)
    record = backup_service.create_backup(db, actor=admin)
    backup_path = backup_service.BACKUP_DIR / record.filename

    raw = bytearray(backup_path.read_bytes())
    raw[-1] ^= 0xFF
    backup_path.write_bytes(bytes(raw))

    with pytest.raises(backup_service.BackupValidationError):
        backup_service.verify_archive(backup_path)


def test_create_backup_fails_and_removes_file_when_self_verify_fails(
    db, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")
    admin = make_user(db, "admin", is_admin=True)

    def _boom(_filepath):
        raise backup_service.BackupValidationError("simulated post-install corruption")

    monkeypatch.setattr(backup_service, "verify_archive", _boom)

    record = backup_service.create_backup(db, actor=admin)

    assert record.status == "failed"
    assert "simulated post-install corruption" in record.error
    assert not list(backup_service.BACKUP_DIR.glob("*.ftbackup"))


def _write_meta_frame(writer: streaming_archive.ArchiveWriter) -> None:
    writer.write_frame(
        {
            "t": "meta",
            "format": streaming_archive.STREAM_FORMAT,
            "version": streaming_archive.STREAM_FORMAT_VERSION,
        }
    )


def test_consume_streaming_archive_rejects_unknown_table(tmp_path):
    path = tmp_path / "archive.bin"
    with streaming_archive.ArchiveWriter(path) as writer:
        _write_meta_frame(writer)
        writer.write_frame({"t": "row", "table": "evil_table", "rows": []})
        writer.close()

    with pytest.raises(backup_service.BackupValidationError):
        backup_service.verify_archive(path)


def test_consume_streaming_archive_rejects_archive_missing_manifest(tmp_path):
    path = tmp_path / "archive.bin"
    with streaming_archive.ArchiveWriter(path) as writer:
        _write_meta_frame(writer)
        writer.write_frame({"t": "row", "table": "users", "rows": []})
        writer.close()

    with pytest.raises(backup_service.BackupValidationError):
        backup_service.verify_archive(path)


def test_media_stager_rejects_path_traversal(tmp_path):
    path = tmp_path / "archive.bin"
    with streaming_archive.ArchiveWriter(path) as writer:
        _write_meta_frame(writer)
        writer.write_frame(
            {
                "t": "media",
                "path": "../escape.txt",
                "chunk_index": 0,
                "final": True,
                "data": "",
                "size_bytes": 0,
                "sha256": hashlib.sha256(b"").hexdigest(),
            }
        )
        writer.close()

    with pytest.raises(backup_service.BackupValidationError):
        backup_service.verify_archive(path)


def test_media_stager_rejects_out_of_order_chunks(tmp_path):
    path = tmp_path / "archive.bin"
    with streaming_archive.ArchiveWriter(path) as writer:
        _write_meta_frame(writer)
        writer.write_frame(
            {
                "t": "media",
                "path": "photo.jpg",
                "chunk_index": 1,
                "final": True,
                "data": "",
                "size_bytes": 0,
                "sha256": hashlib.sha256(b"").hexdigest(),
            }
        )
        writer.close()

    with pytest.raises(backup_service.BackupValidationError):
        backup_service.verify_archive(path)


def test_streaming_backup_enforces_row_count_limit(db, tmp_path, monkeypatch):
    """The row-count ceiling is a defensive circuit breaker, not a product
    limit — tightening it here just makes it observable without a huge
    fixture (the default relation types seeded for every test already exceed
    a limit of 1)."""
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(backup_service, "MAX_TOTAL_ROWS", 1)
    admin = make_user(db, "admin", is_admin=True)

    record = backup_service.create_backup(db, actor=admin)

    assert record.status == "failed"
    assert "maximum row count" in record.error


def test_streaming_backup_enforces_media_file_count_limit(db, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(backup_service, "MAX_MEDIA_FILES", 0)
    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    tree_media = (tmp_path / "media") / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "photo.jpg").write_bytes(b"photo-bytes")

    record = backup_service.create_backup(db, actor=admin)

    assert record.status == "failed"
    assert "maximum media file count" in record.error


def test_streaming_backup_chunks_large_media_across_multiple_frames(
    db, tmp_path, monkeypatch
):
    """A file larger than the chunk size round-trips as several chunk frames."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(backup_service, "MEDIA_CHUNK_BYTES", 4)
    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    content = b"0123456789" * 5
    (tree_media / "photo.jpg").write_bytes(content)

    record = backup_service.create_backup(db, actor=admin)
    assert record.status == "success"
    backup_path = backup_service.BACKUP_DIR / record.filename

    chunk_frames = [
        frame
        for frame in streaming_archive.iter_archive_frames(backup_path)
        if frame.get("t") == "media"
    ]
    assert len(chunk_frames) > 1

    for model in reversed(backup_service.BACKUP_MODELS):
        db.execute(delete(model))
    db.commit()
    shutil.rmtree(media_root)

    backup_service.restore_backup_file(
        db, backup_path, replace=False, media_root=media_root
    )

    assert (tree_media / "photo.jpg").read_bytes() == content


def test_restore_streaming_backup_failure_before_swap_preserves_original(
    db, tmp_path, monkeypatch
):
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    add_member(db, tree, "member-1")
    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "photo.jpg").write_bytes(b"original")

    record = backup_service.create_backup(db, actor=admin)
    assert record.status == "success"
    backup_path = backup_service.BACKUP_DIR / record.filename

    def _boom(*_args, **_kwargs):
        raise RuntimeError("simulated verification failure")

    monkeypatch.setattr(backup_service, "_verify_database_counts", _boom)

    with pytest.raises(RuntimeError):
        backup_service.restore_backup_file(
            db, backup_path, replace=True, media_root=media_root
        )

    assert db.get(Member, "member-1") is not None
    assert (tree_media / "photo.jpg").read_bytes() == b"original"
    assert not backup_service._journal_path(media_root).is_file()
    assert not list(media_root.parent.glob(f"{media_root.name}.restore-*"))


def test_restore_streaming_backup_failure_during_swap_reverts_media(
    db, tmp_path, monkeypatch
):
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    add_member(db, tree, "member-1")
    tree_media = media_root / tree.id
    tree_media.mkdir(parents=True)
    (tree_media / "photo.jpg").write_bytes(b"original")

    record = backup_service.create_backup(db, actor=admin)
    assert record.status == "success"
    backup_path = backup_service.BACKUP_DIR / record.filename

    original_rename = backup_service._rename_dir
    calls = {"n": 0}

    def _flaky_rename(src, dest):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("simulated disk failure")
        return original_rename(src, dest)

    monkeypatch.setattr(backup_service, "_rename_dir", _flaky_rename)

    with pytest.raises(OSError):
        backup_service.restore_backup_file(
            db, backup_path, replace=True, media_root=media_root
        )

    assert (tree_media / "photo.jpg").read_bytes() == b"original"
    assert db.get(Member, "member-1") is not None
    assert not backup_service._journal_path(media_root).is_file()
    assert not list(media_root.parent.glob(f"{media_root.name}.restore-*"))


def test_consume_streaming_archive_rejects_manifest_with_incomplete_media(tmp_path):
    """A manifest that arrives while a media file is still mid-stream must be
    rejected, not accepted with the partial file silently installed."""
    path = tmp_path / "archive.bin"
    with streaming_archive.ArchiveWriter(path) as writer:
        _write_meta_frame(writer)
        writer.write_frame(
            {
                "t": "media",
                "path": "photo.jpg",
                "chunk_index": 0,
                "final": False,
                "data": base64.b64encode(b"partial").decode("ascii"),
            }
        )
        writer.write_frame(
            {
                "t": "manifest",
                "format": streaming_archive.STREAM_FORMAT,
                "version": streaming_archive.STREAM_FORMAT_VERSION,
                "table_row_counts": {},
                "row_count_total": 0,
                "media_count": 0,
                "media_bytes_total": 0,
            }
        )
        writer.close()

    with pytest.raises(backup_service.BackupValidationError):
        backup_service.verify_archive(path)


def test_media_stager_enforces_byte_limit_before_file_completes(monkeypatch):
    """The total-media-bytes ceiling is checked as each chunk streams in, not
    only once a file finishes — otherwise a single oversized file would be
    written to staging in full before ever being rejected."""
    monkeypatch.setattr(backup_service, "MAX_TOTAL_MEDIA_BYTES", 5)
    stager = backup_service._MediaStager(None)

    with pytest.raises(backup_service.BackupValidationError):
        stager.handle_chunk(
            {
                "t": "media",
                "path": "big.bin",
                "chunk_index": 0,
                "final": False,
                "data": base64.b64encode(b"12345678").decode("ascii"),
            }
        )


def test_iter_media_files_is_deterministic_and_complete(tmp_path):
    root = tmp_path / "media"
    (root / "b").mkdir(parents=True)
    (root / "a").mkdir(parents=True)
    (root / "a" / "2.txt").write_bytes(b"2")
    (root / "a" / "1.txt").write_bytes(b"1")
    (root / "b" / "3.txt").write_bytes(b"3")
    (root / "top.txt").write_bytes(b"0")

    first = [
        p.relative_to(root).as_posix() for p in backup_service._iter_media_files(root)
    ]
    second = [
        p.relative_to(root).as_posix() for p in backup_service._iter_media_files(root)
    ]

    assert first == second
    assert set(first) == {"top.txt", "a/1.txt", "a/2.txt", "b/3.txt"}
    assert first.index("a/1.txt") < first.index("a/2.txt")


def test_deferred_member_links_are_flushed_and_restored_correctly(
    db, tmp_path, monkeypatch
):
    """Linked-member FK patches (deferred because the target may not exist
    yet at insert time) still land correctly once bounded per-table flushing
    replaces holding every pair for the whole archive."""
    media_root = tmp_path / "media"
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")

    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, admin)
    first = add_member(db, tree, "member-1")
    second = add_member(db, tree, "member-2")
    first.linked_member_id = second.id
    second.linked_member_id = first.id
    db.commit()

    record = backup_service.create_backup(db, actor=admin)
    assert record.status == "success"
    backup_path = backup_service.BACKUP_DIR / record.filename

    flushed_mappings = []
    original_bulk_update = db.bulk_update_mappings

    def _spy(model, mappings):
        mappings = list(mappings)
        flushed_mappings.extend(mappings)
        return original_bulk_update(model, mappings)

    monkeypatch.setattr(db, "bulk_update_mappings", _spy)

    for model in reversed(backup_service.BACKUP_MODELS):
        db.execute(delete(model))
    db.commit()
    shutil.rmtree(media_root, ignore_errors=True)

    backup_service.restore_backup_file(
        db, backup_path, replace=False, media_root=media_root
    )

    assert len(flushed_mappings) == 2
    assert db.get(Member, "member-1").linked_member_id == "member-2"
    assert db.get(Member, "member-2").linked_member_id == "member-1"
