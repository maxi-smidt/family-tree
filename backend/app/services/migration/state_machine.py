"""Legal ``MigrationRun`` transitions: row-locked and optimistic, so an
impossible regression (e.g. resuming a ``finalized`` run, skipping a phase)
fails closed instead of silently overwriting a further-along state.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.core.exceptions import ConflictError, InvalidInputError
from app.db.base import utcnow_iso
from app.models.migration import (
    MIGRATION_PHASE_ORDER,
    MigrationConflict,
    MigrationConflictStatus,
    MigrationPhase,
    MigrationRun,
    MigrationStatus,
)

# Anything not listed here is an impossible regression.
_LEGAL_STATUS_TRANSITIONS: dict[str, set[str]] = {
    MigrationStatus.RUNNING: {
        MigrationStatus.RUNNING,
        MigrationStatus.COMPLETE,
        MigrationStatus.RECOVERABLE,
        MigrationStatus.FAILED,
    },
    MigrationStatus.RECOVERABLE: {MigrationStatus.RUNNING, MigrationStatus.FAILED},
    MigrationStatus.COMPLETE: {MigrationStatus.FINALIZED},
    MigrationStatus.FAILED: set(),
    MigrationStatus.FINALIZED: set(),
}


def _locked_run(db: Session, run_id: str) -> MigrationRun:
    run = db.execute(
        select(MigrationRun).where(MigrationRun.id == run_id).with_for_update()
    ).scalar_one_or_none()
    if run is None:
        raise InvalidInputError("Migration run not found")
    return run


def _flush(db: Session) -> None:
    try:
        db.flush()
    except StaleDataError as exc:
        raise ConflictError(
            "Migration run changed concurrently; reload and retry"
        ) from exc


def transition_status(db: Session, run_id: str, to_status: str) -> MigrationRun:
    run = _locked_run(db, run_id)
    if to_status not in _LEGAL_STATUS_TRANSITIONS.get(run.status, set()):
        raise InvalidInputError(
            f"Cannot transition migration run from {run.status!r} to {to_status!r}"
        )
    now = utcnow_iso()
    run.status = to_status
    run.updated_at = now
    run.heartbeat_at = now
    if to_status == MigrationStatus.COMPLETE:
        run.completed_at = now
    _flush(db)
    return run


def advance_phase(db: Session, run_id: str, to_phase: str) -> MigrationRun:
    """Move the run's phase forward by exactly one step, or re-save the
    current phase (e.g. a checkpoint-only update). Only legal while running."""
    run = _locked_run(db, run_id)
    if run.status != MigrationStatus.RUNNING:
        raise InvalidInputError("Can only advance phase while the run is running")
    current_index = MIGRATION_PHASE_ORDER.index(MigrationPhase(run.phase))
    to_index = MIGRATION_PHASE_ORDER.index(MigrationPhase(to_phase))
    if to_index not in (current_index, current_index + 1):
        raise InvalidInputError(
            f"Cannot advance migration phase from {run.phase!r} to {to_phase!r}"
        )
    now = utcnow_iso()
    run.phase = to_phase
    run.updated_at = now
    run.heartbeat_at = now
    _flush(db)
    return run


def checkpoint(db: Session, run_id: str, data: dict) -> MigrationRun:
    """Persist phase-private resume state without changing phase/status."""
    run = _locked_run(db, run_id)
    if run.status != MigrationStatus.RUNNING:
        raise InvalidInputError("Can only checkpoint while the run is running")
    run.checkpoint = data
    run.updated_at = utcnow_iso()
    run.heartbeat_at = run.updated_at
    _flush(db)
    return run


def fail_run(
    db: Session,
    run_id: str,
    *,
    failure_code: str,
    failure_detail: str | None,
    recoverable: bool,
) -> MigrationRun:
    run = transition_status(
        db,
        run_id,
        MigrationStatus.RECOVERABLE if recoverable else MigrationStatus.FAILED,
    )
    run.failure_code = failure_code
    run.failure_detail = failure_detail
    _flush(db)
    return run


def finalize_run(db: Session, run_id: str, actor_id: str) -> MigrationRun:
    """Operator finalization: requires automated ``complete`` and no pending
    conflict marked ``blocks_finalization`` — ordinary owner review beyond
    that is non-blocking."""
    run = _locked_run(db, run_id)
    if run.status != MigrationStatus.COMPLETE:
        raise InvalidInputError("Migration run is not ready to finalize")
    blocking = db.execute(
        select(MigrationConflict.id)
        .where(
            MigrationConflict.run_id == run_id,
            MigrationConflict.status == MigrationConflictStatus.PENDING,
            MigrationConflict.blocks_finalization.is_(True),
        )
        .limit(1)
    ).first()
    if blocking is not None:
        raise ConflictError(
            "Cannot finalize while a blocking migration conflict is unresolved"
        )
    now = utcnow_iso()
    run.status = MigrationStatus.FINALIZED
    run.finalized_at = now
    run.finalized_by = actor_id
    run.updated_at = now
    _flush(db)
    return run
