"""Encrypted, portable instance backups and guarded restores.

New backups are written as a bounded streaming archive (format version 3, see
``streaming_archive.py``): every durable model row and every file below
``DATA_PATH/media`` is still covered, but rows are read from the database in
batches and media is read/written in fixed-size chunks, so creating or
restoring a backup never holds the whole database or media tree in memory at
once. A deterministic manifest frame closes the archive with the source
schema epoch, table row counts, and media counts/sizes; a backup is only
reported as successful after its own installed bytes have been re-read and
verified against that manifest.

Older ``.ftbackup`` files (format version 2, a single encrypted JSON bundle)
remain restorable — ``restore_backup_file`` detects the format from the
file's header and dispatches accordingly.

Restores are intentionally an operator action rather than an Admin UI button:
they target a blank instance by default and require an explicit ``replace``
opt-in before removing existing data.
"""

import base64
import hashlib
import json
import logging
import os
import shutil
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from alembic.runtime.migration import MigrationContext
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ConflictError
from app.db.base import new_uuid, utcnow_iso
from app.models import (
    ActivityLog,
    AdminAuditLog,
    AppSetting,
    BackgroundJob,
    ContentScope,
    Document,
    DocumentFile,
    DocumentMemberLink,
    DocumentUpload,
    Event,
    EventDocumentLink,
    EventMemberLink,
    Friendship,
    GalleryImage,
    GalleryMemberLink,
    GalleryUnknownFace,
    GeocodeCache,
    IdentityLink,
    IdentityLinkBlock,
    IdentityLinkEvent,
    IdentityLinkIdempotencyKey,
    LegalAcceptance,
    LegalDocumentVersion,
    Member,
    MemberDisease,
    MemberTask,
    MemberTaskLink,
    MigrationConflict,
    MigrationIdempotencyKey,
    MigrationMapping,
    MigrationReport,
    MigrationRun,
    Notification,
    QualityIssueDismissal,
    Relation,
    RelationType,
    RestoreMarker,
    SavedView,
    SavedViewPosition,
    SavedViewSection,
    SavedViewUserState,
    Section,
    SectionMember,
    SectionPosition,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    User,
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
    VirtualViewSource,
    VirtualViewUserState,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
    WorkspaceSectionGrant,
    WorkspaceSectionPublicLink,
    WorkspaceUserState,
)
from app.models.backup import BackupRecord
from app.models.migration import MigrationStatus
from app.schemas.backup import BackupBundle, MediaItem
from app.services.crypto_export import decrypt_bundle
from app.services.system.admin_audit import record_admin_audit
from app.services.system.backups.streaming_archive import (
    HEADER_LEN,
    MEDIA_CHUNK_BYTES,
    STREAM_FORMAT,
    STREAM_FORMAT_VERSION,
    ArchiveWriter,
    BackupValidationError,
    iter_archive_frames,
    safe_relative_media_path,
)
from app.services.system.backups.streaming_archive import MAGIC as STREAM_MAGIC
from app.services.unit_of_work import UnitOfWork

logger = logging.getLogger("app.backup_service")

BACKUP_VERSION = 2
BACKUP_FORMAT = "family-tree-instance-backup"
BACKUP_DIR: Path = settings.APP_DATA_PATH / "backups"

# Streaming archive batching and defensive ceilings (see streaming_archive.py
# for the per-frame size bound). The counts here are deliberately generous —
# they exist to reject a corrupted or hostile manifest before it can mutate
# anything, not to cap legitimate instance size.
ROW_BATCH_TARGET_ROWS = 500
ROW_BATCH_TARGET_BYTES = 1 * 1024 * 1024
MAX_TOTAL_ROWS = 100_000_000
MAX_MEDIA_FILES = 5_000_000
MAX_TOTAL_MEDIA_BYTES = 5 * 1024**4
MAX_MEDIA_PATH_DEPTH = 32

# Parent tables always precede tables that reference them. See
# BACKUP_EXCLUDED_MODELS below for the models deliberately left out of this
# tuple.
BACKUP_MODELS: tuple[type, ...] = (
    User,
    RelationType,
    AppSetting,
    LegalDocumentVersion,
    GeocodeCache,
    Workspace,
    Member,
    IdentityLink,
    IdentityLinkEvent,
    IdentityLinkBlock,
    IdentityLinkIdempotencyKey,
    Section,
    SectionMember,
    SectionPosition,
    ContentScope,
    WorkspaceMembership,
    WorkspaceInvitation,
    WorkspaceSectionGrant,
    WorkspaceSectionPublicLink,
    WorkspaceUserState,
    Friendship,
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
    DocumentUpload,
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
    VirtualViewUserState,
    SavedView,
    SavedViewSection,
    SavedViewPosition,
    SavedViewUserState,
    MigrationRun,
    MigrationMapping,
    MigrationReport,
    MigrationConflict,
    MigrationIdempotencyKey,
)

# Every other model registered on Base must be listed here, with a reason it
# is not restorable instance content. A model that is neither backed up nor
# excluded here is a backup-completeness bug (see test_backup_service.py).
BACKUP_EXCLUDED_MODELS: tuple[type, ...] = (
    # Its files live in BACKUP_DIR, and including backups inside a backup
    # would recurse indefinitely. Operational metadata, not instance content.
    BackupRecord,
    # A commit witness written *during* a restore; it would be meaningless
    # (and misleading) replayed into a later restore.
    RestoreMarker,
    # A per-user activity inbox that is safe to lose: restoring an instance
    # without it just means read/unread badges reset, nothing is orphaned.
    Notification,
)


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
            "table_row_counts": {name: len(rows) for name, rows in tables.items()},
            "media": [
                {"path": item.path, "size_bytes": item.size_bytes, "sha256": item.sha256}
                for item in media
            ],
        },
    )


def _expected_table_names() -> set[str]:
    return {model.__tablename__ for model in BACKUP_MODELS}


_MODEL_BY_TABLE: dict[str, type] = {model.__tablename__: model for model in BACKUP_MODELS}


def _current_schema_epoch(db: Session) -> str:
    """Return the database's current Alembic head(s) as a stable string."""
    heads = MigrationContext.configure(db.connection()).get_current_heads()
    return ",".join(sorted(heads)) if heads else "unknown"


# Tables added to BACKUP_MODELS after BACKUP_VERSION 2 was first shipped. A v2
# backup taken before the table existed is still a valid v2 backup; treat the
# table as empty on restore rather than rejecting the whole file, so pre-#871
# backups stay restorable. Only ever grows going forward: once a table is
# added here it must never be removed, even if it is later dropped from
# BACKUP_MODELS.
LEGACY_OPTIONAL_TABLES: frozenset[str] = frozenset(
    {
        DocumentUpload.__tablename__,
        WorkspaceUserState.__tablename__,
        VirtualViewUserState.__tablename__,
        # Sections (#982) landed after v2 was already in development; a v2
        # backup taken before this table existed must stay restorable too.
        Section.__tablename__,
        SectionMember.__tablename__,
        SectionPosition.__tablename__,
        ContentScope.__tablename__,
        # Scoped grants/public links/invitation scope (#993) landed after v2
        # was already in development; a v2 backup taken before these existed
        # must stay restorable too.
        WorkspaceSectionGrant.__tablename__,
        WorkspaceSectionPublicLink.__tablename__,
        # Saved views (#986) landed after v2 was already in development; a v2
        # backup taken before these existed must stay restorable too.
        SavedView.__tablename__,
        SavedViewSection.__tablename__,
        SavedViewPosition.__tablename__,
        SavedViewUserState.__tablename__,
        # Durable migration state (#997) landed after v2 was already in
        # development; a v2 backup taken before these existed must stay
        # restorable too.
        MigrationRun.__tablename__,
        MigrationMapping.__tablename__,
        MigrationReport.__tablename__,
        MigrationConflict.__tablename__,
        MigrationIdempotencyKey.__tablename__,
    }
)

LEGACY_FEATURE_OVERRIDE_TABLE = "feature_flag_overrides"
LEGACY_FEATURE_SETTING_PREFIX = "feature."


def _migrate_legacy_last_opened(
    tables: dict[str, Any], source_table: str, target_table: str, fk_field: str
) -> None:
    """Recover *target_table* rows from a pre-#878 backup's now-dropped
    per-row ``last_opened`` column on *source_table*.

    ``bulk_insert_mappings`` silently ignores dict keys that aren't mapped
    columns, so without this the ``last_opened`` values embedded in an old
    ``workspaces``/``virtual_views`` row would just vanish on restore instead of
    landing in the new per-user state table. Mirrors the owner-seeding the
    Alembic migration did for rows already in the live database. No-op when
    *target_table* is already present — that backup was taken by a build new
    enough to have its own (authoritative) rows for it.
    """
    if target_table in tables:
        return
    rows = tables.get(source_table)
    if not isinstance(rows, list):
        return
    state_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        last_opened = row.pop("last_opened", None)
        if last_opened is not None:
            state_rows.append(
                {
                    fk_field: row.get("id"),
                    "user_id": row.get("owner_id"),
                    "last_opened": last_opened,
                }
            )
    tables[target_table] = state_rows


def _backfill_legacy_optional_tables(bundle_dict: dict[str, Any]) -> dict[str, Any]:
    """Add any ``LEGACY_OPTIONAL_TABLES`` missing from an older backup file.

    Mutates and returns *bundle_dict* in place. A no-op for a backup that
    already has every table, i.e. every backup created by this build.
    """
    tables = bundle_dict.get("tables")
    manifest = bundle_dict.get("manifest")
    counts = manifest.get("table_row_counts") if isinstance(manifest, dict) else None
    if not isinstance(tables, dict) or not isinstance(counts, dict):
        return bundle_dict
    _migrate_legacy_last_opened(
        tables, "workspaces", "workspace_user_states", "workspace_id"
    )
    _migrate_legacy_last_opened(
        tables, "virtual_views", "virtual_view_user_states", "view_id"
    )
    for name in LEGACY_OPTIONAL_TABLES:
        tables.setdefault(name, [])
        counts.setdefault(name, len(tables[name]))
    return bundle_dict


def _drop_legacy_feature_metadata(bundle_dict: dict[str, Any]) -> dict[str, Any]:
    """Discard removed flag metadata while restoring an older backup.

    Feature overrides were instance configuration, not genealogy data. Older
    bundles may contain their table and ``feature.*`` app settings; retaining
    either would reintroduce obsolete state after restore.
    """
    tables = bundle_dict.get("tables")
    manifest = bundle_dict.get("manifest")
    counts = manifest.get("table_row_counts") if isinstance(manifest, dict) else None
    if not isinstance(tables, dict) or not isinstance(counts, dict):
        return bundle_dict

    tables.pop(LEGACY_FEATURE_OVERRIDE_TABLE, None)
    counts.pop(LEGACY_FEATURE_OVERRIDE_TABLE, None)

    settings = tables.get(AppSetting.__tablename__)
    if isinstance(settings, list):
        tables[AppSetting.__tablename__] = [
            row
            for row in settings
            if not (
                isinstance(row, dict)
                and isinstance(row.get("key"), str)
                and row["key"].startswith(LEGACY_FEATURE_SETTING_PREFIX)
            )
        ]
        counts[AppSetting.__tablename__] = len(tables[AppSetting.__tablename__])
    return bundle_dict


def validate_bundle(bundle: BackupBundle | dict[str, Any]) -> BackupBundle:
    """Validate format, all table counts, and every embedded media hash.

    Accepts either a ``BackupBundle`` model or a raw dict (e.g. decrypted from
    an existing file). Returns the validated model.
    """
    if isinstance(bundle, dict):
        bundle = _backfill_legacy_optional_tables(bundle)
        bundle = _drop_legacy_feature_metadata(bundle)
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


# --- Streaming (format version 3) archive: write, verify, restore ---------


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _iter_media_files(root: Path) -> Iterator[Path]:
    """Yield every regular file under *root* in a deterministic order.

    Sorts each directory's entries before descending into it, so at most one
    directory's worth of names is ever held in memory — unlike
    ``sorted(root.rglob("*"))``, which would materialize every path in the
    tree up front.
    """
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for filename in sorted(filenames):
            path = Path(dirpath) / filename
            if path.is_file() and not path.is_symlink():
                yield path


def _write_media_frames(writer: ArchiveWriter, path: Path, relative: str) -> int:
    """Stream one media file out as chunk frames, hashing it as it goes.

    Reads one chunk ahead so the final frame — the one carrying the size and
    hash the reader verifies against — can be flagged without needing the
    file size up front. Returns the file's total byte count.
    """
    hasher = hashlib.sha256()
    written = 0
    chunk_index = 0
    with path.open("rb") as fh:
        current = fh.read(MEDIA_CHUNK_BYTES)
        while True:
            following = fh.read(MEDIA_CHUNK_BYTES)
            is_final = not following
            hasher.update(current)
            written += len(current)
            frame: dict[str, Any] = {
                "t": "media",
                "path": relative,
                "chunk_index": chunk_index,
                "final": is_final,
                "data": base64.b64encode(current).decode("ascii"),
            }
            if is_final:
                frame["size_bytes"] = written
                frame["sha256"] = hasher.hexdigest()
            writer.write_frame(frame)
            if is_final:
                return written
            current = following
            chunk_index += 1


def _write_streaming_archive(db: Session, filepath: Path) -> None:
    """Write a bounded streaming backup archive to *filepath*.

    Rows are read from the database in bounded batches — never a whole table
    at once — and media files are read and hashed in fixed-size chunks, so
    peak memory stays proportional to one batch/chunk rather than to instance
    size.
    """
    with ArchiveWriter(filepath) as writer:
        writer.write_frame(
            {"t": "meta", "format": STREAM_FORMAT, "version": STREAM_FORMAT_VERSION}
        )

        table_row_counts: dict[str, int] = {}
        row_count_total = 0
        for model in BACKUP_MODELS:
            table = model.__tablename__
            columns = [column.key for column in sa_inspect(model).mapper.column_attrs]
            count = 0
            batch: list[dict[str, Any]] = []
            batch_bytes = 0
            query = select(model).execution_options(
                yield_per=ROW_BATCH_TARGET_ROWS, stream_results=True
            )
            for item in db.scalars(query):
                row = {column: getattr(item, column) for column in columns}
                db.expunge(item)
                batch.append(row)
                batch_bytes += len(json.dumps(row, default=str))
                count += 1
                if (
                    len(batch) >= ROW_BATCH_TARGET_ROWS
                    or batch_bytes >= ROW_BATCH_TARGET_BYTES
                ):
                    writer.write_frame({"t": "row", "table": table, "rows": batch})
                    batch = []
                    batch_bytes = 0
            if batch:
                writer.write_frame({"t": "row", "table": table, "rows": batch})
            table_row_counts[table] = count
            row_count_total += count

        media_count = 0
        media_bytes_total = 0
        root = settings.media_root
        if root.exists():
            for path in _iter_media_files(root):
                relative = safe_relative_media_path(
                    path.relative_to(root).as_posix()
                ).as_posix()
                media_bytes_total += _write_media_frames(writer, path, relative)
                media_count += 1

        writer.write_frame(
            {
                "t": "manifest",
                "format": STREAM_FORMAT,
                "version": STREAM_FORMAT_VERSION,
                "schema_epoch": _current_schema_epoch(db),
                "created_at": utcnow_iso(),
                "table_row_counts": table_row_counts,
                "row_count_total": row_count_total,
                "media_count": media_count,
                "media_bytes_total": media_bytes_total,
            }
        )
        writer.close()


class _MediaStager:
    """Consumes ``media`` frames, streaming their bytes to disk (or, when
    *staging_root* is ``None``, only through a running hash) while enforcing
    the archive's media limits.

    Chunks for one file must arrive contiguously, in order — that is what
    ``_write_media_frames`` always produces; anything else is corruption.
    """

    def __init__(self, staging_root: Path | None):
        self._staging_root = staging_root
        self._seen_paths: set[str] = set()
        self._active: dict[str, Any] | None = None
        self.media_count = 0
        self.media_bytes_total = 0

    def handle_chunk(self, record: dict[str, Any]) -> None:
        path = record.get("path")
        chunk_index = record.get("chunk_index")
        final = record.get("final")
        data = record.get("data")
        if (
            not isinstance(path, str)
            or not isinstance(chunk_index, int)
            or chunk_index < 0
            or not isinstance(final, bool)
            or not isinstance(data, str)
        ):
            raise BackupValidationError("Backup archive contains a malformed media entry")
        try:
            raw = base64.b64decode(data, validate=True)
        except (TypeError, ValueError) as exc:
            raise BackupValidationError(
                f"Backup archive contains invalid media data for {path}"
            ) from exc
        if len(raw) > MEDIA_CHUNK_BYTES:
            raise BackupValidationError(
                f"Backup media chunk exceeds the maximum chunk size for {path}"
            )

        if chunk_index == 0:
            if self._active is not None:
                raise BackupValidationError(
                    "Backup archive interleaves media file chunks"
                )
            if path in self._seen_paths:
                raise BackupValidationError(f"Backup archive repeats media path {path}")
            if self.media_count + 1 > MAX_MEDIA_FILES:
                raise BackupValidationError(
                    "Backup archive exceeds the maximum media file count"
                )
            relative = safe_relative_media_path(path)
            if len(relative.parts) > MAX_MEDIA_PATH_DEPTH:
                raise BackupValidationError(
                    f"Backup media path is nested too deeply: {path}"
                )
            handle = None
            if self._staging_root is not None:
                destination = self._staging_root.joinpath(*relative.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                handle = open(destination, "wb")
            self._active = {
                "path": path,
                "next_index": 0,
                "written": 0,
                "hasher": hashlib.sha256(),
                "handle": handle,
            }

        active = self._active
        if (
            active is None
            or active["path"] != path
            or chunk_index != active["next_index"]
        ):
            raise BackupValidationError(
                f"Backup media chunks are out of order for {path}"
            )

        if active["handle"] is not None:
            active["handle"].write(raw)
        active["hasher"].update(raw)
        active["written"] += len(raw)
        active["next_index"] += 1

        # Checked on every chunk — including a still-in-progress file's bytes
        # so far — rather than only once a file finishes, so an oversized
        # single file is rejected as it streams instead of after it has
        # already been written to staging in full.
        if self.media_bytes_total + active["written"] > MAX_TOTAL_MEDIA_BYTES:
            raise BackupValidationError(
                "Backup archive exceeds the maximum total media size"
            )

        if not final:
            return

        if active["handle"] is not None:
            active["handle"].close()
        size_bytes = record.get("size_bytes")
        sha256 = record.get("sha256")
        if (
            not isinstance(size_bytes, int)
            or size_bytes != active["written"]
            or not isinstance(sha256, str)
            or sha256 != active["hasher"].hexdigest()
        ):
            raise BackupValidationError(f"Staged media does not match backup for {path}")

        self._seen_paths.add(path)
        self.media_count += 1
        self.media_bytes_total += active["written"]
        self._active = None

    def is_incomplete(self) -> bool:
        """True if a media file's chunks were interrupted before its final one."""
        return self._active is not None

    def close_incomplete(self) -> None:
        if self._active is not None and self._active["handle"] is not None:
            self._active["handle"].close()


def _insert_row_batch(
    db: Session,
    table: str,
    rows: list[Any],
    deferred_member_links: list[dict[str, str | None]],
) -> None:
    model = _MODEL_BY_TABLE[table]
    if not all(isinstance(row, dict) for row in rows):
        raise BackupValidationError(
            f"Backup archive contains a malformed row for {table}"
        )
    prepared = [dict(row) for row in rows]
    if model is Member:
        for row in prepared:
            if row.get("linked_member_id") is not None:
                deferred_member_links.append(
                    {"id": row["id"], "linked_member_id": row["linked_member_id"]}
                )
                row["linked_member_id"] = None
    if prepared:
        db.bulk_insert_mappings(model, prepared)


def _validate_stream_meta(record: dict[str, Any]) -> None:
    if (
        record.get("format") != STREAM_FORMAT
        or record.get("version") != STREAM_FORMAT_VERSION
    ):
        raise BackupValidationError(
            "Backup archive has an unrecognized format or version"
        )


def _validate_manifest_totals(
    manifest: dict[str, Any],
    table_counts: dict[str, int],
    row_count_total: int,
    media: _MediaStager,
) -> None:
    _validate_stream_meta(manifest)
    if manifest.get("table_row_counts") != table_counts:
        raise BackupValidationError(
            "Backup archive manifest row counts do not match its contents"
        )
    if manifest.get("row_count_total") != row_count_total:
        raise BackupValidationError(
            "Backup archive manifest row total does not match its contents"
        )
    if manifest.get("media_count") != media.media_count:
        raise BackupValidationError(
            "Backup archive manifest media count does not match its contents"
        )
    if manifest.get("media_bytes_total") != media.media_bytes_total:
        raise BackupValidationError(
            "Backup archive manifest media size does not match its contents"
        )


def _consume_streaming_archive(
    filepath: Path, *, db: Session | None, staging_root: Path | None
) -> dict[str, Any]:
    """Stream-validate *filepath*, optionally restoring it into *db*/*staging_root*.

    With both ``None`` this is a pure self-verify pass: it never writes to
    disk or touches the database, only recomputing counts and media hashes
    from the decrypted frames and checking them against the archive's own
    manifest. Bounded to O(one frame) of memory, plus O(the members table's
    self-referencing links — see ``deferred_member_links`` below), regardless
    of the archive's total size. Returns the manifest record on success.
    """
    seen_meta = False
    manifest_record: dict[str, Any] | None = None
    table_counts: dict[str, int] = dict.fromkeys(_expected_table_names(), 0)
    row_count_total = 0
    media = _MediaStager(staging_root)
    # Rows are inserted with linked_member_id nulled out (see
    # _insert_row_batch) because the target member may not exist yet; the
    # deferred pairs collected here are patched in once every members row
    # has been inserted, rather than held until the whole archive is done.
    deferred_member_links: list[dict[str, str | None]] = []
    last_row_table: str | None = None

    def _flush_deferred_member_links() -> None:
        if db is not None and deferred_member_links:
            db.bulk_update_mappings(Member, deferred_member_links)
            deferred_member_links.clear()

    try:
        for record in iter_archive_frames(filepath):
            if manifest_record is not None:
                raise BackupValidationError(
                    "Backup archive contains data after its manifest"
                )
            kind = record["t"]
            if kind == "meta":
                if seen_meta:
                    raise BackupValidationError(
                        "Backup archive contains duplicate metadata"
                    )
                _validate_stream_meta(record)
                seen_meta = True
                continue
            if not seen_meta:
                raise BackupValidationError(
                    "Backup archive is missing its metadata header"
                )
            if kind == "row":
                table = record.get("table")
                rows = record.get("rows")
                if table not in table_counts or not isinstance(rows, list):
                    raise BackupValidationError(
                        f"Backup archive references an unknown table {table!r}"
                    )
                if table != last_row_table and last_row_table == Member.__tablename__:
                    _flush_deferred_member_links()
                last_row_table = table
                row_count_total += len(rows)
                if row_count_total > MAX_TOTAL_ROWS:
                    raise BackupValidationError(
                        "Backup archive exceeds the maximum row count"
                    )
                table_counts[table] += len(rows)
                if db is not None:
                    _insert_row_batch(db, table, rows, deferred_member_links)
            elif kind == "media":
                media.handle_chunk(record)
            elif kind == "manifest":
                if media.is_incomplete():
                    raise BackupValidationError(
                        "Backup archive manifest arrived with an incomplete media file"
                    )
                manifest_record = record
            else:
                raise BackupValidationError(
                    f"Backup archive contains an unknown record type {kind!r}"
                )

        if manifest_record is None:
            raise BackupValidationError(
                "Backup archive is truncated or missing its manifest"
            )
        _validate_manifest_totals(manifest_record, table_counts, row_count_total, media)

        _flush_deferred_member_links()
    finally:
        media.close_incomplete()

    return manifest_record


def verify_archive(filepath: Path) -> dict[str, Any]:
    """Stream-validate a completed archive without touching the database or media.

    Used to self-verify a freshly written backup, and available for the
    migration coordinator to confirm a recovery artifact before any
    destructive change (see #994).
    """
    return _consume_streaming_archive(filepath, db=None, staging_root=None)


def _is_streaming_archive(filepath: Path) -> bool:
    with filepath.open("rb") as f:
        header = f.read(HEADER_LEN)
    return header[: len(STREAM_MAGIC)] == STREAM_MAGIC


def _write_staged_media(
    media: list[MediaItem], media_root: Path, restore_id: str
) -> Path:
    staging = media_root.with_name(f"{media_root.name}.restore-stage-{restore_id}")
    staging.mkdir(parents=True, exist_ok=True)
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
        db.scalar(select(func.count()).select_from(model)) == 0 for model in BACKUP_MODELS
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
        if model is MigrationRun:
            # BackupRecord is deliberately excluded from every restorable
            # archive (see BACKUP_EXCLUDED_MODELS below), so a restored run's
            # backup_id/backup_path would otherwise dangle-reference a
            # backup_records row that was never brought back. Mark that
            # recovery artifact unavailable instead of retaining the claim.
            for row in rows:
                row["backup_id"] = None
                row["backup_path"] = None
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
        # allowlisted-commit: the commit must happen strictly after the media
        # swap above (see docstring) — UnitOfWork's after_commit ordering runs
        # the other way (effect after commit), which doesn't fit this journal
        # protocol. No SSE/cache effect to sequence here, only the filesystem
        # steps this function already coordinates by hand.
        db.commit()
    except Exception:
        # allowlisted-rollback: mirrors the allowlisted commit above — undoes
        # the same hand-coordinated DB+filesystem transaction, not a UnitOfWork.
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


def restore_streaming_backup(
    db: Session,
    filepath: Path,
    *,
    replace: bool = False,
    media_root: Path | None = None,
) -> None:
    """Restore a streaming (format version 3) archive.

    Follows the same journaled stage/verify/swap/commit protocol as
    ``restore_bundle`` above (see its docstring for the crash-safety
    reasoning); the difference is that rows are inserted and media is
    written to the staging directory frame by frame as the archive is
    decrypted, instead of after building the whole bundle in memory.
    """
    target_media = media_root or settings.media_root
    if not replace and (
        not _database_is_empty(db) or not _media_root_is_empty(target_media)
    ):
        raise RestoreTargetNotEmptyError(
            "Restore target is not empty; use replace=True only for deliberate recovery"
        )

    restore_id = new_uuid()
    staging = target_media.with_name(f"{target_media.name}.restore-stage-{restore_id}")
    rollback = target_media.with_name(
        f"{target_media.name}.restore-rollback-{restore_id}"
    )
    journal_path = _journal_path(target_media)
    journal_written = False
    staging.mkdir(parents=True, exist_ok=True)

    try:
        if replace:
            _clear_instance(db)
        manifest = _consume_streaming_archive(filepath, db=db, staging_root=staging)
        db.flush()
        _verify_database_counts(db, manifest["table_row_counts"])

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
        db.commit()  # allowlisted-commit: see restore_bundle's docstring
    except Exception:
        db.rollback()  # allowlisted-rollback: see restore_bundle's docstring
        if journal_written:
            _revert_media_swap(target_media, staging, rollback)
            _delete_journal(journal_path)
        shutil.rmtree(staging, ignore_errors=True)
        raise

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
    """Restore a ``.ftbackup`` file, detecting its format from the header.

    Streaming (format version 3) archives are restored directly. Older
    (format version 2) files are still a single encrypted JSON bundle — see
    the module docstring — so they're decrypted and validated as a whole
    before restoring. A version-2 bundle may be a genuine v1.x-era archive
    (v1 table/column names, predating every v2-only table) rather than a
    v2 one; see ``legacy_v1_backup`` for that compatibility adapter.
    """
    if _is_streaming_archive(filepath):
        restore_streaming_backup(db, filepath, replace=replace, media_root=media_root)
        return
    try:
        bundle_dict = decrypt_bundle(filepath.read_bytes(), None)
    except Exception as exc:  # noqa: BLE001
        raise BackupValidationError("Could not decrypt backup file") from exc
    bundle_dict = _drop_legacy_feature_metadata(bundle_dict)

    # Local import: legacy_v1_backup imports this module back (BACKUP_MODELS,
    # _collect_bundle, _insert_rows), so importing it at module scope here
    # would be circular.
    from app.services.system.backups.legacy_v1_backup import (
        convert_v1_bundle,
        is_v1_bundle,
    )

    bundle: BackupBundle | dict[str, Any]
    if is_v1_bundle(bundle_dict.get("tables")):
        bundle = convert_v1_bundle(bundle_dict)
    else:
        bundle_dict = _backfill_legacy_optional_tables(bundle_dict)
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
    """Create and self-verify a full, bounded streaming backup of the instance."""
    _ensure_backup_dir()
    record = BackupRecord(
        id=new_uuid(), created_at=utcnow_iso(), status="running", trigger=trigger
    )
    db.add(record)
    # allowlisted-commit: deliberately its own transaction, independent of the
    # success/failure commit below — the "running" row must be visible to
    # pollers for the whole (possibly slow) backup, not just after it finishes.
    db.commit()
    db.refresh(record)

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    filename = f"backup_{timestamp}_{record.id[:8]}.ftbackup"
    filepath = BACKUP_DIR / filename
    tmp_path = BACKUP_DIR / f".{filename}.tmp"

    try:
        _write_streaming_archive(db, tmp_path)
        # Atomic install: the backup only ever appears at its final name once
        # every frame has been written, flushed, and fsync'd.
        os.replace(tmp_path, filepath)
        _fsync_dir(BACKUP_DIR)
        # Re-read the installed bytes and confirm they match their own
        # manifest before the backup is eligible to be retained or shown as
        # successful.
        verify_archive(filepath)
        size_bytes = filepath.stat().st_size

        record.status = "success"
        record.filename = filename
        record.size_bytes = size_bytes
        record_admin_audit(
            db,
            actor=actor,
            action="create",
            subject_type="backup",
            subject_id=record.id,
            subject_label=filename,
            details={"trigger": trigger, "size_bytes": size_bytes},
        )
        db.commit()  # allowlisted-commit: second phase of the running/done pair above
        logger.info("Backup created and verified: %s (%d bytes)", filename, size_bytes)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Backup failed (trigger=%s)", trigger)
        tmp_path.unlink(missing_ok=True)
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
        db.commit()  # allowlisted-commit: second phase of the running/done pair above
    return record


def list_backups(db: Session) -> list[BackupRecord]:
    return list(
        db.scalars(select(BackupRecord).order_by(BackupRecord.created_at.desc())).all()
    )


def _is_unfinalized_pre_migration_backup(db: Session, record: BackupRecord) -> bool:
    """A ``pre_migration`` backup (see ``app.services.migration.orchestrator``,
    #994) is the only rollback path for a v2 conversion until an operator
    finalizes that run, so it must survive both scheduled pruning and manual
    deletion until then. A failed attempt holds no usable rollback data and
    is never protected, regardless of whether a run references it."""
    if record.trigger != "pre_migration" or record.status != "success":
        return False
    run = db.scalars(
        select(MigrationRun).where(MigrationRun.backup_id == record.id)
    ).first()
    return run is None or run.status != MigrationStatus.FINALIZED


def delete_backup(db: Session, record: BackupRecord) -> None:
    if _is_unfinalized_pre_migration_backup(db, record):
        raise ConflictError(
            "Cannot delete the pre-migration backup before its migration run "
            "is finalized"
        )
    if record.filename:
        filepath = BACKUP_DIR / record.filename
        if filepath.is_file():
            filepath.unlink()
    with UnitOfWork(db):
        db.delete(record)


def prune_backups(db: Session, keep: int) -> None:
    successful = [
        record
        for record in db.scalars(
            select(BackupRecord)
            .where(BackupRecord.status == "success")
            .order_by(BackupRecord.created_at.desc())
        ).all()
        if not _is_unfinalized_pre_migration_backup(db, record)
    ]
    for record in successful[keep:]:
        logger.info("Pruning old backup: %s", record.filename)
        delete_backup(db, record)
