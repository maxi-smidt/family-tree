"""Durable v2 migration state APIs (#997): owner-scoped report/conflict
review, plus admin run status and finalize. The conversion engine itself
(#987/#994/#995) writes the rows these read; this module never runs it."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.models.migration import MigrationConflict, MigrationReport, MigrationRun
from app.models.user import User
from app.schemas.migration import (
    MigrationConflictListOut,
    MigrationConflictOut,
    MigrationConflictResolveRequest,
    MigrationReportListOut,
    MigrationReportOut,
    MigrationRunOut,
)
from app.services.migration import conflicts as conflict_service
from app.services.migration import reports as report_service
from app.services.migration.state_machine import finalize_run
from app.services.system.admin_audit import record_admin_audit
from app.services.system.admin_audit_details import MigrationFinalizeDetails
from app.services.unit_of_work import UnitOfWork

router = APIRouter(prefix="/migration", tags=["migration"])
admin_router = APIRouter(
    prefix="/admin/migration",
    tags=["migration"],
    dependencies=[Depends(require_admin)],
)


def _run_out(run: MigrationRun) -> MigrationRunOut:
    return MigrationRunOut(
        id=run.id,
        source_version=run.source_version,
        target_version=run.target_version,
        status=run.status,
        phase=run.phase,
        backup_id=run.backup_id,
        backup_path=run.backup_path,
        started_at=run.started_at,
        updated_at=run.updated_at,
        heartbeat_at=run.heartbeat_at,
        completed_at=run.completed_at,
        finalized_at=run.finalized_at,
        finalized_by=run.finalized_by,
        failure_code=run.failure_code,
        failure_detail=run.failure_detail,
        checkpoint=run.checkpoint,
    )


def _report_out(report: MigrationReport) -> MigrationReportOut:
    return MigrationReportOut(
        id=report.id,
        run_id=report.run_id,
        owner_user_id=report.owner_user_id,
        workspace_mappings=report.workspace_mappings,
        grant_changes=report.grant_changes,
        converted_virtual_views=report.converted_virtual_views,
        dropped_virtual_views=report.dropped_virtual_views,
        media_verification=report.media_verification,
        validation_summary=report.validation_summary,
        status=report.status,
        acknowledged_by=report.acknowledged_by,
        acknowledged_at=report.acknowledged_at,
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


def _conflict_out(conflict: MigrationConflict) -> MigrationConflictOut:
    return MigrationConflictOut(
        id=conflict.id,
        run_id=conflict.run_id,
        kind=conflict.kind,
        workspace_id=conflict.workspace_id,
        source_section_id=conflict.source_section_id,
        member_a_id=conflict.member_a_id,
        member_b_id=conflict.member_b_id,
        conflicting_fields=conflict.conflicting_fields,
        conflicting_media=conflict.conflicting_media,
        status=conflict.status,
        resolution=conflict.resolution,
        resolved_by=conflict.resolved_by,
        resolved_at=conflict.resolved_at,
        created_at=conflict.created_at,
    )


@router.get("/reports", response_model=MigrationReportListOut)
def list_my_reports(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return MigrationReportListOut(
        reports=[_report_out(r) for r in report_service.list_reports_for_user(db, user)]
    )


@router.get("/reports/{report_id}", response_model=MigrationReportOut)
def get_report(
    report_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _report_out(report_service.get_report_for_owner(db, report_id, user))


@router.post("/reports/{report_id}/acknowledge", response_model=MigrationReportOut)
def acknowledge_report(
    report_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    report = report_service.get_report_for_owner(db, report_id, user)
    return _report_out(report_service.acknowledge_report(db, report, user))


@router.get("/conflicts", response_model=MigrationConflictListOut)
def list_my_conflicts(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return MigrationConflictListOut(
        conflicts=[
            _conflict_out(c) for c in conflict_service.list_conflicts_for_user(db, user)
        ]
    )


@router.get("/conflicts/{conflict_id}", response_model=MigrationConflictOut)
def get_conflict(
    conflict_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _conflict_out(conflict_service.get_conflict_for_owner(db, conflict_id, user))


@router.post("/conflicts/{conflict_id}/resolve", response_model=MigrationConflictOut)
def resolve_conflict(
    conflict_id: str,
    payload: MigrationConflictResolveRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conflict = conflict_service.get_conflict_for_owner(db, conflict_id, user)
    resolved = conflict_service.resolve_conflict(
        db, conflict, user, action=payload.action, fields=payload.fields
    )
    return _conflict_out(resolved)


@admin_router.get("/runs", response_model=list[MigrationRunOut])
def list_runs(db: Session = Depends(get_db)):
    runs = db.scalars(select(MigrationRun).order_by(MigrationRun.started_at.desc())).all()
    return [_run_out(r) for r in runs]


@admin_router.get("/runs/{run_id}", response_model=MigrationRunOut)
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(MigrationRun, run_id)
    if run is None:
        raise NotFoundError("Migration run not found")
    return _run_out(run)


@admin_router.post("/runs/{run_id}/finalize", response_model=MigrationRunOut)
def finalize(
    run_id: str, user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    run = finalize_run(db, run_id, user.id)
    record_admin_audit(
        db,
        actor=user,
        action="finalize",
        subject_type="migration_run",
        subject_id=run.id,
        details=MigrationFinalizeDetails(target_version=run.target_version),
    )
    with UnitOfWork(db):
        pass
    db.refresh(run)
    return _run_out(run)
