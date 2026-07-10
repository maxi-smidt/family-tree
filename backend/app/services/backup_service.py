"""Instance-wide encrypted backup service.

Creates a full logical dump of the database (all users, trees, and content)
plus all media files, encrypted with AES-256-GCM (same key derivation as
single-tree exports). The resulting ``.ftbackup`` file is stored under
``APP_DATA_PATH/backups/``.
"""

import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.base import new_uuid, utcnow_iso
from app.models import (
    ActivityLog,
    AdminAuditLog,
    AppSetting,
    BackupRecord,
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    FeatureFlagOverride,
    GalleryImage,
    GalleryMemberLink,
    Member,
    MemberDisease,
    Relation,
    RelationType,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    Tree,
    TreeMembership,
    User,
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
    VirtualViewSource,
)
from app.services.admin_audit import record_admin_audit
from app.services.crypto_export import encrypt_bundle

logger = logging.getLogger("app.backup_service")

BACKUP_VERSION = 1

BACKUP_DIR: Path = settings.APP_DATA_PATH / "backups"


def _ensure_backup_dir() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def _model_rows(db: Session, model: Any) -> list[dict[str, Any]]:
    """Serialize all rows of a model to plain dicts."""
    items = db.scalars(select(model)).all()
    cols = [c.key for c in sa_inspect(model).mapper.column_attrs]
    return [{c: getattr(item, c) for c in cols} for item in items]


def _collect_bundle(db: Session) -> dict[str, Any]:
    """Build the full instance backup bundle as a plain dict."""
    return {
        "version": BACKUP_VERSION,
        "created_at": utcnow_iso(),
        "users": _model_rows(db, User),
        "trees": _model_rows(db, Tree),
        "tree_memberships": _model_rows(db, TreeMembership),
        "members": _model_rows(db, Member),
        "relations": _model_rows(db, Relation),
        "relation_types": _model_rows(db, RelationType),
        "member_diseases": _model_rows(db, MemberDisease),
        "gallery_images": _model_rows(db, GalleryImage),
        "gallery_links": _model_rows(db, GalleryMemberLink),
        "events": _model_rows(db, Event),
        "event_links": _model_rows(db, EventMemberLink),
        "stories": _model_rows(db, Story),
        "story_links": _model_rows(db, StoryMemberLink),
        "documents": _model_rows(db, Document),
        "document_files": _model_rows(db, DocumentFile),
        "document_member_links": _model_rows(db, DocumentMemberLink),
        "event_document_links": _model_rows(db, EventDocumentLink),
        "story_document_links": _model_rows(db, StoryDocumentLink),
        "activity_log": _model_rows(db, ActivityLog),
        "admin_audit_log": _model_rows(db, AdminAuditLog),
        "app_settings": _model_rows(db, AppSetting),
        "feature_flag_overrides": _model_rows(db, FeatureFlagOverride),
        "virtual_views": _model_rows(db, VirtualView),
        "virtual_view_sources": _model_rows(db, VirtualViewSource),
        "virtual_view_member_matches": _model_rows(db, VirtualViewMemberMatch),
        "virtual_view_positions": _model_rows(db, VirtualViewPosition),
    }


def create_backup(
    db: Session, *, trigger: str = "manual", actor: User | None = None
) -> BackupRecord:
    """Create a full encrypted backup of the instance.

    Inserts a BackupRecord with status='running', builds and encrypts the
    bundle, writes the file, then updates the record to 'success'.
    On any error the record is updated to 'failed' and the exception is
    swallowed (mirroring deletion_sweeper behaviour).
    """
    _ensure_backup_dir()

    record = BackupRecord(
        id=new_uuid(),
        created_at=utcnow_iso(),
        status="running",
        trigger=trigger,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    try:
        bundle = _collect_bundle(db)
        blob = encrypt_bundle(bundle, None)

        ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        filename = f"backup_{ts}_{record.id[:8]}.ftbackup"
        filepath = BACKUP_DIR / filename

        filepath.write_bytes(blob)

        record.status = "success"
        record.filename = filename
        record.size_bytes = len(blob)
        record_admin_audit(
            db,
            actor=actor,
            action="create",
            subject_type="backup",
            subject_id=record.id,
            subject_label=filename,
            details={"trigger": trigger, "size_bytes": record.size_bytes},
        )
        db.commit()
        logger.info("Backup created: %s (%d bytes)", filename, len(blob))
    except Exception as exc:  # noqa: BLE001
        logger.exception("Backup failed (trigger=%s)", trigger)
        record.status = "failed"
        record.error = str(exc)
        db.commit()

    return record


def list_backups(db: Session) -> list[BackupRecord]:
    """Return all backup records ordered newest first."""
    return list(
        db.scalars(
            select(BackupRecord).order_by(BackupRecord.created_at.desc())
        ).all()
    )


def delete_backup(db: Session, record: BackupRecord) -> None:
    """Delete a backup file and its database record."""
    if record.filename:
        filepath = BACKUP_DIR / record.filename
        if filepath.is_file():
            filepath.unlink()
    db.delete(record)
    db.commit()


def prune_backups(db: Session, keep: int) -> None:
    """Delete old successful backups beyond the retention count."""
    successful = list(
        db.scalars(
            select(BackupRecord)
            .where(BackupRecord.status == "success")
            .order_by(BackupRecord.created_at.desc())
        ).all()
    )
    to_remove = successful[keep:]
    for record in to_remove:
        logger.info("Pruning old backup: %s", record.filename)
        delete_backup(db, record)
