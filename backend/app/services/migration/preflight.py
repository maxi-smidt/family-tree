"""Startup-migration preflight checks (#994).

Run once, under the exclusive advisory lock, before the pre-migration backup
or any data conversion: a failure here raises before anything is written, so
a fresh run never persists a ``MigrationRun`` row and the source database and
media tree are left untouched. See ``app.services.migration.orchestrator``.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import is_secret_key_weak, settings
from app.services.system.backups import backup_service


class PreflightError(RuntimeError):
    """An actionable, startup-aborting preflight failure."""


def _check_writable_dir(path: Path, label: str) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".migration-preflight-write-test"
        probe.write_bytes(b"")
        probe.unlink()
    except OSError as exc:
        raise PreflightError(f"{label} ({path}) is not writable: {exc}") from exc


def _dir_size_bytes(path: Path) -> int:
    if not path.is_dir():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _database_size_bytes(db: Session) -> int:
    """Best-effort ``pg_database_size`` lookup. Returns 0 (rather than
    failing the whole preflight) when unsupported — e.g. SQLite in tests, or
    a role without the privilege — since this only widens the estimate; the
    fixed safety margin below still applies."""
    try:
        return int(
            db.execute(text("SELECT pg_database_size(current_database())")).scalar()
            or 0
        )
    except Exception:  # noqa: BLE001 - best-effort estimate, not a correctness gate
        # A failed statement poisons the rest of a Postgres transaction until
        # rolled back; harmless no-op on SQLite, where nothing was pending.
        db.rollback()  # allowlisted-rollback: recover from a failed best-effort probe
        return 0


# A backup roughly duplicates every media byte and the encoded database; this
# margin absorbs encryption/framing overhead and ordinary growth between this
# check and the backup actually running.
_DISK_SPACE_SAFETY_MARGIN_BYTES = 200 * 1024 * 1024


def _check_disk_space(db: Session, backup_dir: Path, media_root: Path) -> None:
    required = (
        _dir_size_bytes(media_root)
        + _database_size_bytes(db)
        + _DISK_SPACE_SAFETY_MARGIN_BYTES
    )
    free = shutil.disk_usage(backup_dir).free
    if free < required:
        raise PreflightError(
            f"Not enough free disk space at {backup_dir} for the pre-migration "
            f"backup: {free} bytes free, ~{required} bytes required"
        )


def _check_backup_encryption_configured() -> None:
    if is_secret_key_weak(settings.SECRET_KEY):
        raise PreflightError(
            "SECRET_KEY is missing or a known placeholder — the pre-migration "
            "backup would be encrypted with a key offering no real protection "
            "and must be set to a unique random value before migrating"
        )


def run_preflight_checks(db: Session) -> None:
    """Verify writable paths, disk space, and backup encryption configuration."""
    backup_dir = backup_service.BACKUP_DIR
    _check_writable_dir(backup_dir, "Backup directory")
    _check_writable_dir(settings.media_root, "Media root")
    _check_disk_space(db, backup_dir, settings.media_root)
    _check_backup_encryption_configured()
