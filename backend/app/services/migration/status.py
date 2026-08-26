"""Public, unauthenticated v2 migration status (#1020).

Exposed at ``GET /api/health/migration`` so an operator or a maintenance
screen can render progress while ``StartupGateMiddleware`` (see
``app.main``) keeps ordinary routes unavailable — before the
``migration_runs`` table exists, while a run is in progress, and after a
terminal failure. Deliberately excludes everything
``app.api.routes.migration`` exposes to an authenticated owner/admin
(workspace/member ids, filesystem backup paths, free-form ``failure_detail``)
so it never leaks private genealogy or environment details.
"""

from __future__ import annotations

from app.models.migration import (
    MIGRATION_PHASE_ORDER,
    MigrationPhase,
    MigrationRun,
    MigrationStatus,
)

# `converting` and `media` collapse into one public "migrating" step — a
# maintenance screen doesn't need the internal resume-phase distinction.
_PUBLIC_PHASE = {
    MigrationPhase.PREFLIGHT: "preflight",
    MigrationPhase.BACKUP: "backup",
    MigrationPhase.CONVERTING: "migrating",
    MigrationPhase.MEDIA: "migrating",
    MigrationPhase.VALIDATING: "validating",
}


def public_migration_status(run: MigrationRun | None) -> dict:
    """Sanitize the latest ``MigrationRun`` (or its absence) into the public
    status contract: a coarse ``status``, the run id, a phase heartbeat, a
    sanitized failure code, and safe (identity-free) progress counters.
    """
    if run is None:
        # No run row yet: either a fresh install, or `alembic upgrade head`
        # hasn't created the table yet on this very first startup.
        return {
            "status": "preflight",
            "run_id": None,
            "phase_heartbeat_at": None,
            "failure_code": None,
            "phase_index": 0,
            "phase_count": len(MIGRATION_PHASE_ORDER),
        }

    if run.status == MigrationStatus.FAILED:
        status = "failed"
    elif run.status in (MigrationStatus.COMPLETE, MigrationStatus.FINALIZED):
        status = "complete"
    else:  # RUNNING or RECOVERABLE: surface where it's at (or will resume)
        status = _PUBLIC_PHASE[MigrationPhase(run.phase)]

    failure_code = run.failure_code if run.status == MigrationStatus.FAILED else None
    return {
        "status": status,
        "run_id": run.id,
        "phase_heartbeat_at": run.heartbeat_at,
        "failure_code": failure_code,
        "phase_index": MIGRATION_PHASE_ORDER.index(MigrationPhase(run.phase)),
        "phase_count": len(MIGRATION_PHASE_ORDER),
    }
