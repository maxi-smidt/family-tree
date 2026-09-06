"""Tests for the v2 startup migration preflight checks (#994)."""

import pytest

from app.core.config import settings
from app.services.migration import preflight
from app.services.system.backups import backup_service


@pytest.fixture(autouse=True)
def _paths(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")


def test_passes_with_writable_paths_space_and_a_strong_secret(db):
    preflight.run_preflight_checks(db)


def test_rejects_unwritable_backup_dir(db, monkeypatch):
    real_mkdir = preflight.Path.mkdir

    def _boom(self, *args, **kwargs):
        if self == backup_service.BACKUP_DIR:
            raise OSError("read-only filesystem")
        return real_mkdir(self, *args, **kwargs)

    monkeypatch.setattr(preflight.Path, "mkdir", _boom)

    with pytest.raises(preflight.PreflightError, match="not writable"):
        preflight.run_preflight_checks(db)


def test_rejects_insufficient_disk_space(db, monkeypatch):
    class _FakeUsage:
        free = 1  # far below any real backup's requirement

    monkeypatch.setattr(preflight.shutil, "disk_usage", lambda _path: _FakeUsage())

    with pytest.raises(preflight.PreflightError, match="disk space"):
        preflight.run_preflight_checks(db)


def test_disk_space_estimate_includes_reported_database_size(db, monkeypatch):
    """A database size the fixed margin alone would not cover must still be
    accounted for (see #994 review: media-light, database-heavy instances)."""
    huge_db_bytes = 10 * 1024**4  # far larger than any real free disk here

    class _FakeUsage:
        free = 500 * 1024 * 1024  # comfortably covers the margin alone

    monkeypatch.setattr(preflight, "_database_size_bytes", lambda _db: huge_db_bytes)
    monkeypatch.setattr(preflight.shutil, "disk_usage", lambda _path: _FakeUsage())

    with pytest.raises(preflight.PreflightError, match="disk space"):
        preflight.run_preflight_checks(db)


def test_database_size_lookup_degrades_to_zero_when_unsupported(db):
    # SQLite has no pg_database_size -> best-effort estimate, not a failure.
    assert preflight._database_size_bytes(db) == 0


def test_rejects_weak_secret_key(db, monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "change-me-in-production")

    with pytest.raises(preflight.PreflightError, match="SECRET_KEY"):
        preflight.run_preflight_checks(db)
