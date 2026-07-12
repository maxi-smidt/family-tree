"""Encrypted, portable instance backups and guarded restores.

An ``.ftbackup`` is an encrypted JSON bundle.  Version 2 records every
durable model row together with every file below ``DATA_PATH/media``.  The
manifest is part of the encrypted payload and contains the expected table row
counts and SHA-256 hashes of the media files, so a backup is only reported as
successful after its own contents have been verified.

Restores are intentionally an operator action rather than an Admin UI button:
they target a blank instance by default and require an explicit ``replace``
opt-in before removing existing data.
"""

import base64
import hashlib
import logging
import shutil
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.base import new_uuid, utcnow_iso
from app.models import (
    ActivityLog,
    AdminAuditLog,
    AppSetting,
    BackgroundJob,
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    FeatureFlagOverride,
    Friendship,
    GalleryImage,
    GalleryMemberLink,
    GeocodeCache,
    LegalAcceptance,
    LegalDocumentVersion,
    Member,
    MemberDisease,
    QualityIssueDismissal,
    Relation,
    RelationType,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    Tree,
    TreeInvitation,
    TreeMembership,
    User,
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
    VirtualViewSource,
)
from app.models.backup import BackupRecord
from app.services.admin_audit import record_admin_audit
from app.services.crypto_export import decrypt_bundle, encrypt_bundle

logger = logging.getLogger("app.backup_service")

BACKUP_VERSION = 2
BACKUP_FORMAT = "family-tree-instance-backup"
BACKUP_DIR: Path = settings.APP_DATA_PATH / "backups"

# Parent tables always precede tables that reference them.  BackupRecord is
# deliberately excluded: its files live in BACKUP_DIR, and including backups
# inside a backup would recurse indefinitely.  It is operational metadata, not
# restored instance content.
BACKUP_MODELS: tuple[type, ...] = (
    User,
    RelationType,
    AppSetting,
    LegalDocumentVersion,
    GeocodeCache,
    Tree,
    Member,
    TreeMembership,
    TreeInvitation,
    Friendship,
    FeatureFlagOverride,
    Relation,
    MemberDisease,
    GalleryImage,
    GalleryMemberLink,
    Event,
    EventMemberLink,
    Story,
    StoryMemberLink,
    Document,
    DocumentFile,
    DocumentMemberLink,
    EventDocumentLink,
    StoryDocumentLink,
    ActivityLog,
    AdminAuditLog,
    BackgroundJob,
    LegalAcceptance,
    QualityIssueDismissal,
    VirtualView,
    VirtualViewSource,
    VirtualViewMemberMatch,
    VirtualViewPosition,
)


class BackupValidationError(ValueError):
    """Raised when a backup is incomplete, corrupt, or incompatible."""


class RestoreTargetNotEmptyError(ValueError):
    """Raised when a restore would overwrite data without explicit consent."""


def _ensure_backup_dir() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def _model_rows(db: Session, model: type) -> list[dict[str, Any]]:
    """Serialize all rows of a model to plain dictionaries."""
    items = db.scalars(select(model)).all()
    columns = [column.key for column in sa_inspect(model).mapper.column_attrs]
    return [{column: getattr(item, column) for column in columns} for item in items]


def _file_digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _safe_media_relative(path: str) -> PurePosixPath:
    relative = PurePosixPath(path)
    if (
        relative.is_absolute()
        or not relative.parts
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        raise BackupValidationError("Backup contains an unsafe media path")
    return relative


def _collect_media() -> list[dict[str, Any]]:
    """Serialize every regular file in the media root with a content hash."""
    root = settings.media_root
    if not root.exists():
        return []

    media: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root).as_posix()
        _safe_media_relative(relative)
        raw = path.read_bytes()
        media.append(
            {
                "path": relative,
                "size_bytes": len(raw),
                "sha256": _file_digest(raw),
                "data": base64.b64encode(raw).decode("ascii"),
            }
        )
    return media


def _collect_bundle(db: Session) -> dict[str, Any]:
    """Build a complete, self-verifying instance backup bundle."""
    tables = {model.__tablename__: _model_rows(db, model) for model in BACKUP_MODELS}
    media = _collect_media()
    return {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "created_at": utcnow_iso(),
        "tables": tables,
        "media": media,
        "manifest": {
            "format": BACKUP_FORMAT,
            "version": BACKUP_VERSION,
            "table_row_counts": {
                name: len(rows) for name, rows in tables.items()
            },
            "media": [
                {
                    "path": item["path"],
                    "size_bytes": item["size_bytes"],
                    "sha256": item["sha256"],
                }
                for item in media
            ],
        },
    }


def validate_bundle(bundle: dict[str, Any]) -> None:
    """Validate format, all table counts, and every embedded media hash."""
    manifest = bundle.get("manifest")
    if (
        bundle.get("format") != BACKUP_FORMAT
        or bundle.get("version") != BACKUP_VERSION
        or not isinstance(manifest, dict)
        or manifest.get("format") != BACKUP_FORMAT
        or manifest.get("version") != BACKUP_VERSION
    ):
        raise BackupValidationError("Unsupported instance backup format")

    tables = bundle.get("tables")
    expected_counts = manifest.get("table_row_counts")
    if not isinstance(tables, dict) or not isinstance(expected_counts, dict):
        raise BackupValidationError("Backup manifest is missing table metadata")
    expected_table_names = {model.__tablename__ for model in BACKUP_MODELS}
    if (
        set(tables) != expected_table_names
        or set(expected_counts) != expected_table_names
    ):
        raise BackupValidationError("Backup does not contain every required table")
    for name, rows in tables.items():
        if not isinstance(rows, list) or expected_counts.get(name) != len(rows):
            raise BackupValidationError(f"Backup row count does not match for {name}")

    media = bundle.get("media")
    expected_media = manifest.get("media")
    if not isinstance(media, list) or not isinstance(expected_media, list):
        raise BackupValidationError("Backup manifest is missing media metadata")
    if len(media) != len(expected_media):
        raise BackupValidationError("Backup media count does not match manifest")
    expected_by_path = {item.get("path"): item for item in expected_media}
    if len(expected_by_path) != len(expected_media):
        raise BackupValidationError("Backup manifest contains duplicate media paths")
    for item in media:
        if not isinstance(item, dict):
            raise BackupValidationError("Backup contains invalid media metadata")
        path = item.get("path")
        _safe_media_relative(path if isinstance(path, str) else "")
        expected = expected_by_path.get(path)
        if expected is None:
            raise BackupValidationError("Backup media is not listed in manifest")
        try:
            raw = base64.b64decode(item.get("data", ""), validate=True)
        except (TypeError, ValueError) as exc:
            raise BackupValidationError("Backup contains invalid media data") from exc
        if (
            item.get("size_bytes") != len(raw)
            or item.get("sha256") != _file_digest(raw)
            or expected.get("size_bytes") != len(raw)
            or expected.get("sha256") != _file_digest(raw)
        ):
            raise BackupValidationError(f"Backup media hash does not match for {path}")
    if {item["path"] for item in media} != set(expected_by_path):
        raise BackupValidationError("Backup media paths do not match manifest")


def _verify_database_counts(db: Session, expected_counts: dict[str, int]) -> None:
    for model in BACKUP_MODELS:
        actual = db.scalar(select(func.count()).select_from(model))
        if actual != expected_counts[model.__tablename__]:
            raise BackupValidationError(
                f"Restored row count does not match for {model.__tablename__}"
            )


def _write_staged_media(media: list[dict[str, Any]], media_root: Path) -> Path:
    staging = media_root.with_name(f"{media_root.name}.restore-{uuid4().hex}")
    try:
        for item in media:
            relative = _safe_media_relative(item["path"])
            destination = staging.joinpath(*relative.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(base64.b64decode(item["data"], validate=True))
        return staging
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def _media_root_is_empty(media_root: Path) -> bool:
    return not media_root.exists() or not any(media_root.iterdir())


def _database_is_empty(db: Session) -> bool:
    return all(
        db.scalar(select(func.count()).select_from(model)) == 0
        for model in BACKUP_MODELS
    )


def _clear_instance(db: Session, media_root: Path) -> None:
    """Remove restorable data in dependency-safe reverse order."""
    for model in reversed(BACKUP_MODELS):
        db.execute(delete(model))
    db.flush()
    if media_root.exists():
        shutil.rmtree(media_root)


def _insert_rows(db: Session, tables: dict[str, list[dict[str, Any]]]) -> None:
    """Restore rows while deferring the one nullable self-reference."""
    linked_members: list[dict[str, str | None]] = []
    for model in BACKUP_MODELS:
        rows = [dict(row) for row in tables[model.__tablename__]]
        if model is Member:
            for row in rows:
                if row.get("linked_member_id") is not None:
                    linked_members.append(
                        {"id": row["id"], "linked_member_id": row["linked_member_id"]}
                    )
                    row["linked_member_id"] = None
        if rows:
            db.bulk_insert_mappings(model, rows)
    if linked_members:
        db.bulk_update_mappings(Member, linked_members)


def restore_bundle(
    db: Session,
    bundle: dict[str, Any],
    *,
    replace: bool = False,
    media_root: Path | None = None,
) -> None:
    """Restore a validated backup into a blank instance or explicit replacement.

    ``replace`` is intentionally false by default.  This guard makes the safe
    operator path a fresh database/media volume, while still allowing a fully
    scripted disaster-recovery replacement with an explicit flag.
    """
    validate_bundle(bundle)
    target_media = media_root or settings.media_root
    if not replace and (
        not _database_is_empty(db) or not _media_root_is_empty(target_media)
    ):
        raise RestoreTargetNotEmptyError(
            "Restore target is not empty; use replace=True only for deliberate recovery"
        )

    staging = _write_staged_media(bundle["media"], target_media)
    try:
        if replace:
            _clear_instance(db, target_media)
        _insert_rows(db, bundle["tables"])
        db.flush()
        _verify_database_counts(db, bundle["manifest"]["table_row_counts"])
        db.commit()
        target_media.parent.mkdir(parents=True, exist_ok=True)
        if target_media.exists():
            # A blank running instance creates this directory at startup.
            target_media.rmdir()
        staging.replace(target_media)
    except Exception:
        db.rollback()
        shutil.rmtree(staging, ignore_errors=True)
        raise


def restore_backup_file(
    db: Session, filepath: Path, *, replace: bool = False, media_root: Path | None = None
) -> None:
    """Decrypt and restore a server-encrypted ``.ftbackup`` file."""
    try:
        bundle = decrypt_bundle(filepath.read_bytes(), None)
    except Exception as exc:  # noqa: BLE001
        raise BackupValidationError("Could not decrypt backup file") from exc
    restore_bundle(db, bundle, replace=replace, media_root=media_root)


def create_backup(
    db: Session, *, trigger: str = "manual", actor: User | None = None
) -> BackupRecord:
    """Create and self-verify a full encrypted backup of the instance."""
    _ensure_backup_dir()
    record = BackupRecord(
        id=new_uuid(), created_at=utcnow_iso(), status="running", trigger=trigger
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    filepath: Path | None = None

    try:
        bundle = _collect_bundle(db)
        validate_bundle(bundle)
        blob = encrypt_bundle(bundle, None)
        # Verify the encrypted file can be decrypted and still validates before
        # it is eligible to be retained or displayed as successful.
        validate_bundle(decrypt_bundle(blob, None))

        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        filename = f"backup_{timestamp}_{record.id[:8]}.ftbackup"
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
        logger.info("Backup created and verified: %s (%d bytes)", filename, len(blob))
    except Exception as exc:  # noqa: BLE001
        logger.exception("Backup failed (trigger=%s)", trigger)
        if filepath is not None:
            filepath.unlink(missing_ok=True)
        record.status = "failed"
        record.error = str(exc)
        record_admin_audit(
            db,
            actor=actor,
            action="create",
            subject_type="backup",
            subject_id=record.id,
            subject_label=None,
            details={"trigger": trigger, "status": "failed", "error": str(exc)[:500]},
        )
        db.commit()
    return record


def list_backups(db: Session) -> list[BackupRecord]:
    return list(
        db.scalars(select(BackupRecord).order_by(BackupRecord.created_at.desc())).all()
    )


def delete_backup(db: Session, record: BackupRecord) -> None:
    if record.filename:
        filepath = BACKUP_DIR / record.filename
        if filepath.is_file():
            filepath.unlink()
    db.delete(record)
    db.commit()


def prune_backups(db: Session, keep: int) -> None:
    successful = list(
        db.scalars(
            select(BackupRecord)
            .where(BackupRecord.status == "success")
            .order_by(BackupRecord.created_at.desc())
        ).all()
    )
    for record in successful[keep:]:
        logger.info("Pruning old backup: %s", record.filename)
        delete_backup(db, record)
