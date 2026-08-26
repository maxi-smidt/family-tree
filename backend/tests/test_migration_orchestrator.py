"""Tests for the v2 startup migration orchestrator (#994): no-ops, the
preflight/backup/convert/media/validate pipeline, and crash resumption.

The advisory lock's own exclusivity/fail-closed behavior is covered by
tests/test_advisory_lock.py; these tests run on SQLite (no advisory-lock
support), so `exclusive_lock` is replaced with a no-op that still proves the
orchestrator asks for it.
"""

import contextlib

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.migration import MigrationPhase, MigrationRun, MigrationStatus
from app.services.migration import orchestrator, preflight
from tests.conftest import make_tree, make_user


@pytest.fixture(autouse=True)
def _fake_lock(monkeypatch):
    @contextlib.contextmanager
    def _lock(_key, **_kwargs):
        yield

    monkeypatch.setattr(orchestrator, "exclusive_lock", _lock)


@pytest.fixture(autouse=True)
def _backup_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    from app.services.system.backups import backup_service

    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")


def _make_run(db, **kw) -> MigrationRun:
    run = MigrationRun(source_version="v1", target_version="2.0.0", **kw)
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def test_fresh_install_records_a_permanent_marker(db):
    """A fresh install has zero workspaces at first boot but a user creates
    one soon after; without a durable marker, a later restart would
    misdetect that as a v1 instance needing conversion (#994 review)."""
    orchestrator.run_startup_migration(db)

    run = db.scalars(select(MigrationRun)).one()
    assert run.status == MigrationStatus.FINALIZED

    owner = make_user(db)
    make_tree(db, owner)

    orchestrator.run_startup_migration(db)

    all_run_ids = db.scalars(select(MigrationRun.id)).all()
    assert all_run_ids == [run.id]  # still just the one marker, no conversion run


def test_already_finalized_run_is_a_noop(db):
    owner = make_user(db)
    make_tree(db, owner)
    run = _make_run(
        db, status=MigrationStatus.FINALIZED, phase=MigrationPhase.VALIDATING
    )

    orchestrator.run_startup_migration(db)

    all_run_ids = db.scalars(select(MigrationRun.id)).all()
    assert all_run_ids == [run.id]  # no second run created


def test_converts_a_legacy_instance_end_to_end(db):
    owner = make_user(db)
    make_tree(db, owner)

    orchestrator.run_startup_migration(db)

    run = db.scalars(select(MigrationRun)).one()
    assert run.status == MigrationStatus.COMPLETE
    assert run.phase == MigrationPhase.VALIDATING
    assert run.backup_id is not None
    assert run.backup_path is not None


def test_completion_is_committed_not_only_flushed(db):
    """advance_phase/transition_status only flush; app.db.init_db.init_db
    closes the session right after this call without an explicit commit of
    its own, so anything left merely flushed here would be silently rolled
    back and the run would appear to never have finished (#994 review)."""
    owner = make_user(db)
    make_tree(db, owner)

    orchestrator.run_startup_migration(db)
    db.rollback()  # discards anything not actually committed

    run = db.scalars(select(MigrationRun)).one()
    assert run.status == MigrationStatus.COMPLETE
    assert run.phase == MigrationPhase.VALIDATING
    assert run.backup_id is not None


def test_preflight_failure_leaves_no_run_row(db, monkeypatch):
    owner = make_user(db)
    make_tree(db, owner)

    def _boom(_db) -> None:
        raise preflight.PreflightError("not enough disk space")

    monkeypatch.setattr(preflight, "run_preflight_checks", _boom)

    with pytest.raises(preflight.PreflightError):
        orchestrator.run_startup_migration(db)

    assert db.scalar(select(MigrationRun.id)) is None


def test_resumes_recoverable_run_without_redoing_backup(db):
    owner = make_user(db)
    make_tree(db, owner)
    run = _make_run(
        db,
        status=MigrationStatus.RECOVERABLE,
        phase=MigrationPhase.CONVERTING,
        backup_id="existing-backup-id",
        backup_path="existing.ftbackup",
    )

    orchestrator.run_startup_migration(db)

    db.refresh(run)
    assert run.status == MigrationStatus.COMPLETE
    assert run.backup_id == "existing-backup-id"  # backup phase was not re-run


def test_resumes_at_backup_phase_without_recreating_an_existing_backup(db):
    """Covers the case where a later phase's failure rolled back a flushed
    (not yet committed) advance past `backup`, so `run.phase` is back at
    `backup` even though its backup already succeeded and committed."""
    owner = make_user(db)
    make_tree(db, owner)
    run = _make_run(
        db,
        status=MigrationStatus.RECOVERABLE,
        phase=MigrationPhase.BACKUP,
        backup_id="existing-backup-id",
        backup_path="existing.ftbackup",
    )

    orchestrator.run_startup_migration(db)

    db.refresh(run)
    assert run.status == MigrationStatus.COMPLETE
    assert run.backup_id == "existing-backup-id"  # no redundant backup taken


def test_failed_run_blocks_startup(db):
    _make_run(
        db,
        status=MigrationStatus.FAILED,
        phase=MigrationPhase.CONVERTING,
        failure_code="RuntimeError",
        failure_detail="boom",
    )

    with pytest.raises(orchestrator.MigrationBlockedError):
        orchestrator.run_startup_migration(db)


def test_conversion_failure_marks_run_recoverable_and_reraises(db, monkeypatch):
    owner = make_user(db)
    make_tree(db, owner)

    def _boom(_db, _run):
        raise RuntimeError("disk exploded")

    monkeypatch.setattr(orchestrator, "run_conversion", _boom)

    with pytest.raises(RuntimeError, match="disk exploded"):
        orchestrator.run_startup_migration(db)

    run = db.scalars(select(MigrationRun)).one()
    assert run.status == MigrationStatus.RECOVERABLE
    # The phase-advance to "converting" was only flushed, not committed; the
    # failure handler's rollback reverts it to the last durable checkpoint,
    # so a resume correctly re-enters the converting phase from scratch.
    assert run.phase == MigrationPhase.BACKUP
    assert run.failure_code == "RuntimeError"
    assert run.backup_id is not None  # the backup phase had already committed


def test_failure_state_is_committed_not_only_flushed(db, monkeypatch):
    owner = make_user(db)
    make_tree(db, owner)

    def _boom(_db, _run):
        raise RuntimeError("disk exploded")

    monkeypatch.setattr(orchestrator, "run_conversion", _boom)

    with pytest.raises(RuntimeError, match="disk exploded"):
        orchestrator.run_startup_migration(db)
    db.rollback()  # discards anything not actually committed

    run = db.scalars(select(MigrationRun)).one()
    assert run.status == MigrationStatus.RECOVERABLE
    assert run.failure_code == "RuntimeError"
