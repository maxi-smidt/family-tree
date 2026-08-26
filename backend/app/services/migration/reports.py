"""Per-owner migration reports (#997) — the durable record a
``migration_report_ready`` notification only points to."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import AccessDeniedError, NotFoundError
from app.db.base import utcnow_iso
from app.models.migration import MigrationMapping, MigrationReport, MigrationReportStatus
from app.models.user import User
from app.services.unit_of_work import UnitOfWork


def get_report_for_owner(db: Session, report_id: str, user: User) -> MigrationReport:
    report = db.get(MigrationReport, report_id)
    if report is None:
        raise NotFoundError("Migration report not found")
    if report.owner_user_id != user.id and not user.is_admin:
        raise AccessDeniedError("Cannot read another owner's migration report")
    return report


def list_reports_for_user(db: Session, user: User) -> list[MigrationReport]:
    return list(
        db.scalars(
            select(MigrationReport)
            .where(MigrationReport.owner_user_id == user.id)
            .order_by(MigrationReport.created_at)
        )
    )


def acknowledge_report(
    db: Session, report: MigrationReport, user: User
) -> MigrationReport:
    if report.status != MigrationReportStatus.ACKNOWLEDGED:
        report.status = MigrationReportStatus.ACKNOWLEDGED
        report.acknowledged_by = user.id
        report.acknowledged_at = utcnow_iso()
        report.updated_at = report.acknowledged_at
        with UnitOfWork(db):
            pass
        db.refresh(report)
    return report


def resolve_legacy_workspace_id(db: Session, workspace_id: str) -> str | None:
    """Where a pre-conversion workspace id ended up, for a stale deep link or
    public bookmark (#1012). Unauthenticated-safe: this only ever hands back
    an id, never workspace content — normal read authorization still applies
    once the caller follows it."""
    mapping = db.scalar(
        select(MigrationMapping)
        .where(MigrationMapping.source_workspace_id == workspace_id)
        .order_by(MigrationMapping.created_at.desc())
        .limit(1)
    )
    return mapping.target_workspace_id if mapping else None


def create_report(
    db: Session,
    *,
    run_id: str,
    owner_user_id: str,
    workspace_mappings: list[dict],
    grant_changes: list[dict],
    converted_virtual_views: list[dict],
    dropped_virtual_views: list[dict],
    media_verification: dict,
    validation_summary: dict,
) -> MigrationReport:
    """Idempotent: replaying the reporting phase for the same (run, owner)
    returns the existing row via ``uq_migration_report_owner`` instead of
    raising a duplicate-key error."""

    def _existing() -> MigrationReport | None:
        return db.scalar(
            select(MigrationReport).where(
                MigrationReport.run_id == run_id,
                MigrationReport.owner_user_id == owner_user_id,
            )
        )

    if (report := _existing()) is not None:
        return report

    report = MigrationReport(
        run_id=run_id,
        owner_user_id=owner_user_id,
        workspace_mappings=workspace_mappings,
        grant_changes=grant_changes,
        converted_virtual_views=converted_virtual_views,
        dropped_virtual_views=dropped_virtual_views,
        media_verification=media_verification,
        validation_summary=validation_summary,
    )
    db.add(report)
    try:
        with UnitOfWork(db):
            pass
    except IntegrityError:
        if (report := _existing()) is None:
            raise
        return report
    db.refresh(report)
    return report
