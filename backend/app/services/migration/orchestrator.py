"""The v2 startup migration orchestrator (#994): preflight, exclusivity,
backup, and the resume contract around
``app.services.migration.converter.run_conversion`` (#987) and
``app.services.migration.media.run_media_relocation`` (#995).

Called once from ``app.db.init_db.init_db``, itself run from the FastAPI
``lifespan`` before ``yield`` — before this process, or (under
``WORKERS > 1``) any sibling worker process blocking on the same advisory
lock inside its own startup, serves a request or starts a background loop.
That ordering, plus the blocking lock in ``app.db.advisory_lock.exclusive_lock``,
is what keeps a normal request or background job from mutating v1 data while
the backup or conversion runs, without a separate maintenance-mode flag.

Why the pre-migration backup happens *after* ``alembic upgrade head`` rather
than before it: every v2 revision's ``upgrade()`` is additive or a rename
(see ``alembic/versions/v2_0_0_*.py`` — every ``drop_table``/``drop_column``
call in that chain is in ``downgrade()``, not ``upgrade()``), so nothing
destructive has happened by the time this module runs. The actually
destructive, hard-to-reverse step is the application-level data
consolidation below — merging per-owner workspaces, deleting the absorbed
rows, moving media on disk — which is why the backup is taken immediately
before *that*, not before the schema migration. One consequence: the backup
is itself v2-shaped (``workspaces``, not ``trees``), so restoring it needs
this same v2 image, not the v1 image being upgraded from — a genuine v1
rollback needs the operator's own pre-upgrade snapshot instead.

Rollback: see the "Upgrading from v1.x to v2.0.0" section of docs/OPERATIONS.md.
"""

from __future__ import annotations

import logging

from alembic.runtime.migration import MigrationContext
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.advisory_lock import exclusive_lock
from app.db.base import utcnow_iso
from app.models import Workspace
from app.models.migration import (
    MIGRATION_PHASE_ORDER,
    MigrationPhase,
    MigrationRun,
    MigrationStatus,
)
from app.services.migration import preflight
from app.services.migration.converter import run_conversion
from app.services.migration.media import run_media_relocation
from app.services.migration.state_machine import (
    advance_phase,
    fail_run,
    transition_status,
)
from app.services.system.backups.backup_service import create_backup
from app.services.unit_of_work import UnitOfWork

logger = logging.getLogger("app.migration")

# Distinct from single_leader's key space (see backup_scheduler/deletion_sweeper).
MIGRATION_LOCK_KEY = 0x46540003

TARGET_VERSION = "2.0.0"


class MigrationBlockedError(RuntimeError):
    """Raised when a prior run failed unrecoverably; refuses to start rather
    than guess at resuming or silently reconverting."""


def _needs_conversion(db: Session) -> bool:
    """True when workspaces already exist and no migration run has ever been
    recorded — a v1 instance's first v2 startup. Only meaningful the very
    first time this runs on a given database: see ``_record_fresh_install``
    for why a fresh install still needs a durable marker of its own."""
    return bool(db.scalar(select(func.count()).select_from(Workspace)))


def _record_fresh_install(db: Session) -> None:
    """Persist a permanent "nothing to convert" marker for a fresh v2 install.

    Without this, a fresh install has zero workspaces at its very first
    startup (so ``_needs_conversion`` is False and no run is created), but a
    user creates a workspace soon after — and every startup with no run row
    re-evaluates ``_needs_conversion`` from scratch, so it would then read
    True and incorrectly route native v2 data through the legacy converter.
    """
    run = MigrationRun(
        source_version="none",
        target_version=TARGET_VERSION,
        status=MigrationStatus.FINALIZED,
        phase=MigrationPhase.VALIDATING,
        completed_at=utcnow_iso(),
        finalized_at=utcnow_iso(),
    )
    with UnitOfWork(db):
        db.add(run)


def _latest_run(db: Session) -> MigrationRun | None:
    return db.scalars(
        select(MigrationRun).order_by(MigrationRun.started_at.desc()).limit(1)
    ).first()


def _source_version(db: Session) -> str:
    heads = MigrationContext.configure(db.connection()).get_current_heads()
    return ",".join(sorted(heads)) if heads else "unknown"


def _phase_index(phase: str) -> int:
    return MIGRATION_PHASE_ORDER.index(MigrationPhase(phase))


def _ensure_phase(db: Session, run: MigrationRun, phase: str) -> bool:
    """Advance ``run`` to ``phase`` if it hasn't reached it yet.

    Returns whether the caller should (re)run that phase's action: True if
    ``run`` is now at (or was already at) ``phase``, False if it is already
    further along — the crash-safe resume path for #997's checkpoint/replay
    contract.
    """
    current, target = _phase_index(run.phase), _phase_index(phase)
    if current > target:
        return False
    if current < target:
        advance_phase(db, run.id, phase)
    return True


def _run_backup(db: Session, run: MigrationRun) -> MigrationRun:
    if run.backup_id is not None:
        # Already captured (e.g. a resume where the advance to `converting`
        # was flushed but not committed before a later phase failed, so
        # `run.phase` reverted to `backup` without this needing to redo).
        return run
    record = create_backup(db, trigger="pre_migration")
    if record.status != "success":
        raise RuntimeError(f"Pre-migration backup failed: {record.error}")
    # create_backup streams every BACKUP_MODELS row (migration_runs included)
    # out of the session as it archives them (see
    # backup_service._write_streaming_archive's db.expunge(item)), so `run`
    # is no longer session-tracked by the time this returns — re-fetch it
    # before mutating it further, or the backup_id/backup_path below would
    # silently never flush.
    run = db.get(MigrationRun, run.id)
    run.backup_id = record.id
    run.backup_path = record.filename
    with UnitOfWork(db):
        pass
    logger.info("Pre-migration backup %s created for run %s", record.filename, run.id)
    return run


def _run_migration_locked(db: Session) -> None:
    run = _latest_run(db)

    if run is not None and run.status in (
        MigrationStatus.COMPLETE,
        MigrationStatus.FINALIZED,
    ):
        return  # already converted; safe no-op
    if run is not None and run.status == MigrationStatus.FAILED:
        raise MigrationBlockedError(
            f"Migration run {run.id} failed at phase {run.phase!r} "
            f"({run.failure_code}: {run.failure_detail}) and cannot resume "
            "automatically. Restore the pre-migration backup or resolve the "
            "underlying issue before restarting — see the "
            "'Upgrading from v1.x to v2.0.0' section of docs/OPERATIONS.md."
        )
    if run is None and not _needs_conversion(db):
        _record_fresh_install(db)
        return

    # Checked for every fresh or resumed attempt, never skipped for an
    # already-finished run above — a transient failure here (e.g. low disk)
    # must not touch `run`'s persisted state, so it can simply retry cleanly
    # on the next restart.
    preflight.run_preflight_checks(db)

    if run is None:
        run = MigrationRun(
            source_version=_source_version(db), target_version=TARGET_VERSION
        )
        with UnitOfWork(db):
            db.add(run)
    elif run.status == MigrationStatus.RECOVERABLE:
        transition_status(db, run.id, MigrationStatus.RUNNING)
        with UnitOfWork(db):
            pass
    # else: RUNNING — a prior process crashed mid-run; we hold the exclusive
    # lock, so resuming it here is safe.

    try:
        if _ensure_phase(db, run, MigrationPhase.BACKUP):
            run = _run_backup(db, run)
        if _ensure_phase(db, run, MigrationPhase.CONVERTING):
            run_conversion(db, run)
        if _ensure_phase(db, run, MigrationPhase.MEDIA):
            run_media_relocation(db, run)
        _ensure_phase(db, run, MigrationPhase.VALIDATING)
        transition_status(db, run.id, MigrationStatus.COMPLETE)
        # advance_phase/transition_status only flush; every prior state
        # change in this try block — including any left uncommitted because
        # a phase with nothing to do never called its own UnitOfWork — must
        # be made durable here, or closing the session (see
        # app.db.init_db.init_db) rolls all of it back and the run appears
        # never to have finished.
        with UnitOfWork(db):
            pass
        logger.info(
            "v2 migration run %s complete (backup=%s)", run.id, run.backup_path
        )
    except Exception as exc:  # noqa: BLE001 - must always fail the run, then re-raise
        logger.exception("v2 migration run %s failed in phase %s", run.id, run.phase)
        # A failure mid-flush can leave the session needing a rollback before
        # it can be used again; harmless no-op if it doesn't.
        db.rollback()  # allowlisted-rollback: recover session before fail_run writes
        fail_run(
            db,
            run.id,
            failure_code=type(exc).__name__,
            failure_detail=str(exc)[:2000],
            recoverable=True,
        )
        # Same durability requirement as the success path above: fail_run's
        # writes must be committed before this session closes.
        with UnitOfWork(db):
            pass
        raise


def run_startup_migration(db: Session) -> None:
    """Entry point called once from ``init_db`` after ``alembic upgrade
    head``, on the same session used for the rest of startup bootstrap.
    No-ops for a fresh install or an already-finalized/complete instance;
    otherwise runs (or resumes) the one v2 conversion run under a blocking,
    fail-closed advisory lock so concurrent worker startups serialize onto a
    single run instead of racing.
    """
    with exclusive_lock(MIGRATION_LOCK_KEY):
        _run_migration_locked(db)
