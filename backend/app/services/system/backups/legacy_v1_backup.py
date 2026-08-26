"""Compatibility adapter for restoring v1.x-era ``.ftbackup`` archives (#996).

A v1 instance backup is a JSON bundle in the exact ``BackupBundle`` shape
(format version 2 — see ``app.schemas.backup``): the *archive format* never
changed. What differs is the *schema epoch*: ``tables`` uses v1 table/column
names (``trees``, ``tree_id``, ...) and predates every v2-only table
(identity links, sections, saved views, migration bookkeeping, ...).

This module recognizes that shape, verifies it against its own declared
manifest before touching anything, and converts it into a fully v2-shaped
``BackupBundle`` by staging it through the same conversion machinery the live
v1 -> v2 upgrade uses — never by re-deriving those rules by hand:

- Table/column renames and the legacy bridge -> identity-link conversion are
  loaded directly from their Alembic revisions (``v2_0_0_rename_workspaces``,
  ``v2_0_0_identity_links``) instead of being duplicated here, since revision
  files under ``alembic/versions`` aren't an importable package (see
  ``_load_revision`` below).
- Workspace consolidation and media relocation reuse
  ``app.services.migration.converter.run_conversion`` and
  ``app.services.migration.media.run_media_relocation`` unmodified, against a
  throwaway in-memory database and a throwaway media directory — the same
  functions, in the same order, the real startup migration runs them in.

The staged, fully-converted result is re-serialized with
``backup_service._collect_bundle`` (so it carries a genuine, self-consistent
v2 manifest) and handed back to the ordinary v2 restore path. Verification
downstream (``backup_service.validate_bundle``/``restore_bundle``) therefore
checks the converted counts against *that* manifest, never against the
original v1 counts — consolidation legitimately changes row counts, so
equality to the source is never the right check there.
"""

from __future__ import annotations

import base64
import importlib.util
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.core.config import settings
from app.db.base import Base
from app.models import (
    ContentScope,
    IdentityLink,
    IdentityLinkBlock,
    IdentityLinkEvent,
    IdentityLinkIdempotencyKey,
    MigrationConflict,
    MigrationIdempotencyKey,
    MigrationMapping,
    MigrationReport,
    MigrationRun,
    SavedView,
    SavedViewPosition,
    SavedViewSection,
    SavedViewUserState,
    Section,
    SectionMember,
    SectionPosition,
    WorkspaceSectionGrant,
    WorkspaceSectionPublicLink,
)
from app.models.migration import MigrationPhase, MigrationStatus
from app.schemas.backup import BackupBundle, MediaItem
from app.services.migration.converter import run_conversion
from app.services.migration.media import run_media_relocation
from app.services.system.backups.streaming_archive import BackupValidationError

# ---------------------------------------------------------------------------
# Alembic revisions, loaded by file path rather than dotted import: revision
# modules under alembic/versions/ are never a package (no __init__.py, and
# the top-level "alembic" name is the installed library), but they are still
# the single source of truth for these deterministic rules.
# ---------------------------------------------------------------------------

_ALEMBIC_VERSIONS_DIR = (
    Path(app.__file__).resolve().parent.parent / "alembic" / "versions"
)


def _load_revision(name: str):
    path = _ALEMBIC_VERSIONS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(
        f"_legacy_v1_backup_revision_{name}", path
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load Alembic revision {name!r} from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_rename_revision = _load_revision("v2_0_0_rename_workspaces")
_identity_link_revision = _load_revision("v2_0_0_identity_links")

# (v1_table, v2_table)
TABLE_RENAMES: tuple[tuple[str, str], ...] = _rename_revision.TABLE_RENAMES
# (v2_table, v1_column, v2_column)
COLUMN_RENAMES: tuple[tuple[str, str, str], ...] = _rename_revision.COLUMN_RENAMES
_migrate_legacy_bridges_to_identity_links = (
    _identity_link_revision.migrate_legacy_bridges_to_identity_links
)

_V1_TO_V2_TABLE: dict[str, str] = dict(TABLE_RENAMES)
_V2_TO_V1_TABLE: dict[str, str] = {new: old for old, new in TABLE_RENAMES}

# Tables in the current v2 model registry that were introduced by schema work
# that happened *after* the v1 -> v2 cutover itself (see the corresponding
# alembic/versions/v2_0_0_*.py revisions) and therefore can never appear in a
# genuine v1 archive. A v1 restore always synthesizes these — empty, or (for
# the identity-link family) populated deterministically from the legacy
# bridge columns by the staged conversion below.
_V2_ONLY_TABLES: frozenset[str] = frozenset(
    model.__tablename__
    for model in (
        IdentityLink,
        IdentityLinkEvent,
        IdentityLinkBlock,
        IdentityLinkIdempotencyKey,
        Section,
        SectionMember,
        SectionPosition,
        ContentScope,
        WorkspaceSectionGrant,
        WorkspaceSectionPublicLink,
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
)


def _v1_expected_tables() -> frozenset[str]:
    """The exact v1 table-name manifest: every table a genuine v1 archive
    must contain, and no other — the "explicit backup-format/schema
    compatibility ... exact-table manifest" #996 asks for."""
    from app.services.system.backups.backup_service import BACKUP_MODELS

    v2_names = {model.__tablename__ for model in BACKUP_MODELS} - _V2_ONLY_TABLES
    return frozenset(_V2_TO_V1_TABLE.get(name, name) for name in v2_names)


def is_v1_bundle(tables: Any) -> bool:
    """True when *tables* is an exact v1 (pre-cutover) table-name manifest."""
    if not isinstance(tables, dict):
        return False
    return set(tables) == _v1_expected_tables()


def _rename_v1_tables(
    v1_tables: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    """Rename every v1 table/column name to its v2 equivalent. Row values are
    otherwise untouched — the deterministic identity/consolidation
    conversion happens later, against a real staged database."""
    column_renames_by_v1_table: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for v2_table, old_col, new_col in COLUMN_RENAMES:
        v1_table = _V2_TO_V1_TABLE.get(v2_table, v2_table)
        column_renames_by_v1_table[v1_table].append((old_col, new_col))

    converted: dict[str, list[dict[str, Any]]] = {}
    for v1_table, rows in v1_tables.items():
        v2_table = _V1_TO_V2_TABLE.get(v1_table, v1_table)
        renames = column_renames_by_v1_table.get(v1_table, ())
        new_rows = []
        for row in rows:
            new_row = dict(row)
            for old_col, new_col in renames:
                if old_col in new_row:
                    new_row[new_col] = new_row.pop(old_col)
            new_rows.append(new_row)
        converted[v2_table] = new_rows
    return converted


def _verify_v1_manifest(
    bundle_dict: dict[str, Any],
) -> tuple[dict[str, list[dict[str, Any]]], list[MediaItem]]:
    """Validate the *original* v1 archive against its own declared manifest —
    row counts and media hashes — before any conversion touches anything.

    Media hash/size/path-safety checks are format-agnostic (``MediaItem``'s
    own validators), so they're reused as-is here rather than re-derived.
    """
    tables = bundle_dict.get("tables")
    if not isinstance(tables, dict) or not tables:
        raise BackupValidationError("Backup does not contain any tables")
    if not is_v1_bundle(tables):
        raise BackupValidationError("Backup does not contain every required v1 table")

    manifest = bundle_dict.get("manifest")
    counts = manifest.get("table_row_counts") if isinstance(manifest, dict) else None
    if not isinstance(counts, dict) or set(counts) != set(tables):
        raise BackupValidationError("Backup manifest is missing table metadata")
    for name, rows in tables.items():
        if not isinstance(rows, list):
            raise BackupValidationError(f"Backup table {name!r} is not a row list")
        if counts.get(name) != len(rows):
            raise BackupValidationError(f"Backup row count does not match for {name}")

    try:
        media_items = [
            MediaItem.model_validate(item) for item in bundle_dict.get("media") or []
        ]
    except Exception as exc:  # noqa: BLE001 - re-raised as the domain error below
        raise BackupValidationError(f"Invalid backup media: {exc}") from exc

    return tables, media_items


def _materialize_media(media_items: list[MediaItem], root: Path) -> None:
    for item in media_items:
        dest = root / item.path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(base64.b64decode(item.data))


def _staging_session_factory() -> sessionmaker:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def convert_v1_bundle(bundle_dict: dict[str, Any]) -> BackupBundle:
    """Convert a validated v1-shaped bundle dict into a fully v2-shaped,
    self-consistent ``BackupBundle`` ready for the ordinary restore path
    (``backup_service.restore_bundle``).
    """
    # Local imports: backup_service imports this module (lazily, only when a
    # v1 archive is actually seen) so importing it back at module scope here
    # would be circular.
    from app.services.system.backups.backup_service import (
        BACKUP_MODELS,
        _collect_bundle,
        _insert_rows,
    )

    v1_tables, media_items = _verify_v1_manifest(bundle_dict)

    v2_tables = _rename_v1_tables(v1_tables)
    for model in BACKUP_MODELS:
        v2_tables.setdefault(model.__tablename__, [])

    session_factory = _staging_session_factory()
    with tempfile.TemporaryDirectory(prefix="ftbackup-v1-restore-") as staging_dir:
        staging_media_root = Path(staging_dir) / "media"
        staging_media_root.mkdir(parents=True, exist_ok=True)
        _materialize_media(media_items, staging_media_root)

        # run_media_relocation reads settings.media_root globally rather than
        # taking a path argument, so it's pointed at the staging directory
        # for the duration of this call and restored in `finally`. Safe only
        # because restore is a standalone, one-shot CLI operation (see
        # restore_backup.py) with no concurrent request traffic to race.
        original_data_path = settings.DATA_PATH
        settings.DATA_PATH = Path(staging_dir)
        try:
            with session_factory() as staging_db:
                _insert_rows(staging_db, v2_tables)
                staging_db.flush()

                # Same order the live upgrade uses: alembic's own bridge ->
                # identity-link conversion runs as part of `alembic upgrade
                # head`, strictly before the app-level converting/media
                # phases (see app.services.migration.orchestrator).
                _migrate_legacy_bridges_to_identity_links(staging_db.connection())
                staging_db.flush()

                run = MigrationRun(
                    source_version="v1-archive",
                    target_version="2.0.0",
                    status=MigrationStatus.COMPLETE,
                    phase=MigrationPhase.VALIDATING,
                )
                staging_db.add(run)
                staging_db.flush()

                run_conversion(staging_db, run)
                run_media_relocation(staging_db, run)
                # allowlisted-commit: a throwaway staging session, not a live
                # mutation — nothing to sequence an after-commit effect with.
                staging_db.commit()

                converted = _collect_bundle(staging_db)
        finally:
            settings.DATA_PATH = original_data_path

    return converted
