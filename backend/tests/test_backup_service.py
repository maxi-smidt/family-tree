"""Integration coverage for encrypted full-instance backup and restore."""

import pytest

from app.core.config import settings
from app.models import (
    BackgroundJob,
    Document,
    DocumentFile,
    Friendship,
    GeocodeCache,
    LegalDocumentVersion,
    Member,
    QualityIssueDismissal,
    TreeInvitation,
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
    VirtualViewSource,
)
from app.services import backup_service
from app.services.crypto_export import decrypt_bundle
from tests.conftest import add_member, make_tree, make_user


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
        TreeInvitation(
            id="invite-1",
            tree_id=tree.id,
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
            tree_id=tree.id,
            issue_id="issue-1",
            issue_type="missing_parent",
            member_ids='["member-1"]',
            dismissed_by_id=admin.id,
        )
    )
    document = Document(
        id="document-1",
        tree_id=tree.id,
        title="Certificate",
        created_at="now",
        updated_at="now",
    )
    db.add(document)
    db.add(
        DocumentFile(
            id="file-1",
            tree_id=tree.id,
            document_id=document.id,
            kind="file",
            filename="certificate.pdf",
            url=f"{settings.API_PREFIX}/media/{tree.id}/certificate.pdf",
            mime_type="application/pdf",
            size=12,
            created_at="now",
        )
    )
    view = VirtualView(
        id="vv-1", name="Compare", owner_id=admin.id, created_at="now"
    )
    db.add(view)
    db.add(VirtualViewSource(view_id=view.id, position=0, tree_id=tree.id))
    db.add(
        VirtualViewMemberMatch(
            view_id=view.id, member_id=first.id, group_id="group"
        )
    )
    db.add(
        VirtualViewPosition(
            view_id=view.id, node_id=first.id, position_x=1, position_y=2
        )
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
    bundle = decrypt_bundle(backup_path.read_bytes(), None)
    backup_service.validate_bundle(bundle)
    assert set(bundle["tables"]) == {
        model.__tablename__ for model in backup_service.BACKUP_MODELS
    }
    assert len(bundle["tables"]["friendships"]) == 1
    assert len(bundle["tables"]["tree_invitations"]) == 1
    assert len(bundle["tables"]["quality_issue_dismissals"]) == 1
    assert len(bundle["tables"]["geocode_cache"]) == 1

    # This simulates a blank-instance recovery in the same database/volume.
    backup_service.restore_bundle(db, bundle, replace=True, media_root=media_root)

    assert db.get(Member, first.id).linked_member_id == second.id
    assert db.get(Member, second.id).linked_member_id == first.id
    assert db.get(TreeInvitation, "invite-1") is not None
    assert db.get(QualityIssueDismissal, "dismissal-1") is not None
    assert db.get(GeocodeCache, "Vienna") is not None
    assert db.get(BackgroundJob, "job-1") is not None
    assert db.get(DocumentFile, "file-1") is not None
    assert db.get(VirtualView, "vv-1") is not None
    assert (tree_media / "certificate.pdf").read_bytes() == b"full backup\x00"
    original_path = tree_media / "originals" / "certificate.original.pdf"
    assert original_path.read_bytes() == b"original"


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
