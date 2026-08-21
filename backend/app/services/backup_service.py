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
import json
import logging
import shutil
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from pydantic import ValidationError
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
    GalleryUnknownFace,
    GeocodeCache,
    LegalAcceptance,
    LegalDocumentVersion,
    Member,
    MemberDisease,
    MemberTask,
    MemberTaskLink,
    QualityIssueDismissal,
    Relation,
    RelationType,
    RestoreMarker,
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
from app.schemas.backup import BackupBundle, MediaItem
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
    MemberTask,
    MemberTaskLink,
    GalleryImage,
    GalleryMemberLink,
    GalleryUnknownFace,
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


def _collect_media() -> list[MediaItem]:
    """Serialize every regular file in the media root with a content hash."""
    root = settings.media_root
    if not root.exists():
        return []

    media: list[MediaItem] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root).as_posix()
        _safe_media_relative(relative)
        raw = path.read_bytes()
        media.append(
            MediaItem(
                path=relative,
                size_bytes=len(raw),
                sha256=_file_digest(raw),
                data=base64.b64encode(raw).decode("ascii"),
            )
        )
    return media


def _collect_bundle(db: Session) -> BackupBundle:
    """Build a complete, self-verifying instance backup bundle."""
    tables = {model.__tablename__: _model_rows(db, model) for model in BACKUP_MODELS}
    media = _collect_media()
    return BackupBundle(
        format=BACKUP_FORMAT,
        version=BACKUP_VERSION,
        created_at=utcnow_iso(),
        tables=tables,
        media=media,
        manifest={
            "format": BACKUP_FORMAT,
            "version": BACKUP_VERSION,
            "table_row_counts": {
                name: len(rows) for name, rows in tables.items()
            },
            "media": [
                {"path": item.path, "size_bytes": item.size_bytes, "sha256": item.sha256}
                for item in media
            ],
        },
    )


def _expected_table_names() -> set[str]:
    return {model.__tablename__ for model in BACKUP_MODELS}


def validate_bundle(bundle: BackupBundle | dict[str, Any]) -> BackupBundle:
    """Validate format, all table counts, and every embedded media hash.

    Accepts either a ``BackupBundle`` model or a raw dict (e.g. decrypted from
    an existing file). Returns the validated model.
    """
    if isinstance(bundle, dict):
        try:
            bundle = BackupBundle.model_validate(bundle)
        except ValidationError as exc:
            raise BackupValidationError(
                f"Invalid instance backup: {exc.errors(include_url=False)}"
            ) from exc

    expected_table_names = _expected_table_names()
    if set(bundle.tables) != expected_table_names:
        raise BackupValidationError("Backup does not contain every required table")
    if set(bundle.manifest.table_row_counts) != expected_table_names:
        raise BackupValidationError("Backup manifest is missing table metadata")
    for name, rows in bundle.tables.items():
        if bundle.manifest.table_row_counts.get(name) != len(rows):
            raise BackupValidationError(f"Backup row count does not match for {name}")

    return bundle


def _verify_database_counts(db: Session, expected_counts: dict[str, int]) -> None:
    for model in BACKUP_MODELS:
        actual = db.scalar(select(func.count()).select_from(model))
        if actual != expected_counts[model.__tablename__]:
            raise BackupValidationError(
                f"Restored row count does not match for {model.__tablename__}"
            )


def _write_staged_media(
    media: list[MediaItem], media_root: Path, restore_id: str
) -> Path:
    staging = media_root.with_name(f"{media_root.name}.restore-stage-{restore_id}")
    try:
        for item in media:
            relative = _safe_media_relative(item.path)
            destination = staging.joinpath(*relative.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(base64.b64decode(item.data, validate=True))
        return staging
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def _verify_staged_media(staging: Path, media: list[MediaItem]) -> None:
    """Re-read every staged file from disk and confirm it matches the backup.

    The in-memory bytes were already hash-checked while the bundle was
    validated; this catches corruption introduced by the write to disk itself
    before anything live is touched.
    """
    for item in media:
        relative = _safe_media_relative(item.path)
        raw = staging.joinpath(*relative.parts).read_bytes()
        if len(raw) != item.size_bytes or _file_digest(raw) != item.sha256:
            raise BackupValidationError(
                f"Staged media does not match backup for {item.path}"
            )


def _media_root_is_empty(media_root: Path) -> bool:
    return not media_root.exists() or not any(media_root.iterdir())


def _database_is_empty(db: Session) -> bool:
    return all(
        db.scalar(select(func.count()).select_from(model)) == 0
        for model in BACKUP_MODELS
    )


def _clear_instance(db: Session) -> None:
    """Remove restorable rows in dependency-safe reverse order.

    Media is handled separately by the journaled swap in ``restore_bundle``;
    this only ever touches the (uncommitted) database transaction.
    """
    for model in reversed(BACKUP_MODELS):
        db.execute(delete(model))
    db.flush()


def _journal_path(media_root: Path) -> Path:
    return media_root.with_name(f"{media_root.name}.restore-journal.json")


def _write_journal(journal_path: Path, data: dict[str, str]) -> None:
    """Write the journal atomically (write-tmp, then rename) so a crash mid
    write never leaves a half-written, unparseable journal behind."""
    tmp = journal_path.with_suffix(journal_path.suffix + ".tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(journal_path)


def _read_journal(journal_path: Path) -> dict[str, str] | None:
    if not journal_path.is_file():
        return None
    try:
        return json.loads(journal_path.read_text())
    except (OSError, json.JSONDecodeError):
        logger.exception(
            "Could not read restore journal at %s; leaving it for manual inspection",
            journal_path,
        )
        return None


def _delete_journal(journal_path: Path) -> None:
    journal_path.unlink(missing_ok=True)
    journal_path.with_suffix(journal_path.suffix + ".tmp").unlink(missing_ok=True)


def _rename_dir(src: Path, dest: Path) -> None:
    src.rename(dest)


def _swap_media(media_root: Path, staging: Path, rollback: Path) -> None:
    """Move any existing media root aside, then install the staged directory.

    Both renames are filesystem-atomic. If the second one fails, the first
    has already landed and ``rollback`` holds the original content, which
    ``_revert_media_swap`` (and startup reconciliation) know how to undo.
    """
    if media_root.exists():
        _rename_dir(media_root, rollback)
    _rename_dir(staging, media_root)


def _revert_media_swap(media_root: Path, staging: Path, rollback: Path) -> None:
    """Undo ``_swap_media``, regardless of how far it got.

    ``media_root`` existing is not on its own proof that the swap installed
    new content there — if the crash happened before the second rename, it
    still holds the untouched original and must not be deleted. The second
    rename (``staging`` -> ``media_root``) is what actually replaces the
    content, so ``staging`` having already been consumed (no longer exists)
    is the only reliable signal that ``media_root`` now holds the staged
    data rather than the original.
    """
    if not staging.exists() and media_root.exists():
        shutil.rmtree(media_root, ignore_errors=True)
    if rollback.exists():
        _rename_dir(rollback, media_root)


def _finalize_restore(rollback: Path, journal_path: Path) -> None:
    """Drop the preserved pre-restore media and the journal after a commit."""
    shutil.rmtree(rollback, ignore_errors=True)
    _delete_journal(journal_path)


def _sweep_orphaned_media_dirs(media_root: Path) -> None:
    """Remove staging/rollback directories left by a restore that crashed
    before it ever wrote a journal entry (nothing to reconcile against)."""
    if not media_root.parent.is_dir():
        return
    patterns = (
        f"{media_root.name}.restore-stage-*",
        f"{media_root.name}.restore-rollback-*",
    )
    for pattern in patterns:
        for path in media_root.parent.glob(pattern):
            shutil.rmtree(path, ignore_errors=True)


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
    bundle: BackupBundle | dict[str, Any],
    *,
    replace: bool = False,
    media_root: Path | None = None,
) -> None:
    """Restore a validated backup into a blank instance or explicit replacement.

    ``replace`` is intentionally false by default.  This guard makes the safe
    operator path a fresh database/media volume, while still allowing a fully
    scripted disaster-recovery replacement with an explicit flag.

    The swap is journaled so a crash never leaves a half-restored instance:
    media is staged and hash-verified on disk, then the database is populated
    and verified inside an *uncommitted* transaction — nothing live has been
    touched yet, so any failure up to here is a plain rollback. Only once the
    database side is known-good does the journal get written and the live
    media directory get swapped (old content preserved at ``rollback``), and
    a ``RestoreMarker`` row is inserted and committed with the restored data
    in the same transaction — so the marker's presence *is* the proof the
    commit landed. If the process dies anywhere after the journal is written,
    ``reconcile_interrupted_restore`` uses that marker on the next startup to
    finish the swap forward or roll it back.
    """
    validated = validate_bundle(bundle)
    target_media = media_root or settings.media_root
    if not replace and (
        not _database_is_empty(db) or not _media_root_is_empty(target_media)
    ):
        raise RestoreTargetNotEmptyError(
            "Restore target is not empty; use replace=True only for deliberate recovery"
        )

    restore_id = new_uuid()
    staging = _write_staged_media(validated.media, target_media, restore_id)
    rollback = target_media.with_name(
        f"{target_media.name}.restore-rollback-{restore_id}"
    )
    journal_path = _journal_path(target_media)
    journal_written = False

    try:
        _verify_staged_media(staging, validated.media)
        if replace:
            _clear_instance(db)
        _insert_rows(db, validated.tables)
        db.flush()
        _verify_database_counts(db, validated.manifest.table_row_counts)

        _write_journal(
            journal_path,
            {
                "id": restore_id,
                "media_root": str(target_media),
                "staging": str(staging),
                "rollback": str(rollback),
                "created_at": utcnow_iso(),
            },
        )
        journal_written = True
        _swap_media(target_media, staging, rollback)
        db.add(RestoreMarker(id=restore_id))
        db.commit()
    except Exception:
        db.rollback()
        if journal_written:
            _revert_media_swap(target_media, staging, rollback)
            _delete_journal(journal_path)
        shutil.rmtree(staging, ignore_errors=True)
        raise

    # The database and media are now consistent regardless of what happens
    # from here; a failure finalizing cleanup just leaves the rollback copy
    # and journal for the next startup's reconcile_interrupted_restore to
    # clear away (see the "marker present" branch there).
    _finalize_restore(rollback, journal_path)


def reconcile_interrupted_restore(db: Session, media_root: Path | None = None) -> None:
    """Finish or roll back a restore interrupted by a crash, on startup.

    Called from ``init_db`` after migrations run (the ``restore_markers``
    table and any restored tables must exist) and before the media root is
    (re)created. A restore that never wrote a journal entry needs no
    reconciliation: it never reached the swap, or it already cleaned up after
    itself.
    """
    target_media = media_root or settings.media_root
    journal_path = _journal_path(target_media)

    if journal_path.is_file():
        journal = _read_journal(journal_path)
        if journal is None:
            # Corrupt/unreadable journal: we cannot tell what state the swap
            # is in, so don't touch anything — in particular, don't let the
            # sweep below guess and delete a rollback directory that may hold
            # the only surviving copy of the pre-restore media.
            logger.error(
                "Restore journal at %s exists but could not be read; leaving "
                "all restore-* directories in place for manual recovery.",
                journal_path,
            )
            return

        restore_id = journal["id"]
        staging = Path(journal["staging"])
        rollback = Path(journal["rollback"])

        logger.warning("Reconciling interrupted restore %s", restore_id)
        if db.get(RestoreMarker, restore_id) is None:
            logger.warning(
                "Restore %s was interrupted before its transaction committed; "
                "rolling media back to the pre-restore state.",
                restore_id,
            )
            _revert_media_swap(target_media, staging, rollback)
        else:
            logger.warning(
                "Restore %s had committed before the interruption; finishing cleanup.",
                restore_id,
            )
            shutil.rmtree(rollback, ignore_errors=True)

        shutil.rmtree(staging, ignore_errors=True)
        _delete_journal(journal_path)

    _sweep_orphaned_media_dirs(target_media)


def restore_backup_file(
    db: Session, filepath: Path, *, replace: bool = False, media_root: Path | None = None
) -> None:
    """Decrypt and restore a server-encrypted ``.ftbackup`` file."""
    try:
        bundle_dict = decrypt_bundle(filepath.read_bytes(), None)
    except Exception as exc:  # noqa: BLE001
        raise BackupValidationError("Could not decrypt backup file") from exc
    try:
        bundle = BackupBundle.model_validate(bundle_dict)
    except ValidationError as exc:
        raise BackupValidationError(
            f"Invalid instance backup: {exc.errors(include_url=False)}"
        ) from exc
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
        blob = encrypt_bundle(bundle.model_dump(), None)
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
