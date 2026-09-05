"""Per-owner migration reports (#997) — the durable record a
``migration_report_ready`` notification only points to."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import AccessDeniedError, NotFoundError
from app.db.base import utcnow_iso
from app.models import Section, User
from app.models.migration import MigrationMapping, MigrationReport, MigrationReportStatus
from app.schemas.notification import MigrationReportReadyPayload
from app.services.activity.activity import record_activity
from app.services.collaboration.notification_service import create_notification
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.grants import widen_grant_to_workspace


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
    create_notification(
        db,
        owner_user_id,
        "migration_report_ready",
        MigrationReportReadyPayload(run_id=run_id, report_id=report.id),
    )
    return report


def widen_grant_change(
    db: Session, report: MigrationReport, user: User, *, section_id: str, user_id: str
) -> dict:
    """Widen one of this report's ``grant_changes`` entries back to
    workspace-wide access — the only owner-facing way to do so (#991); see
    ``app.services.workspaces.grants.widen_grant_to_workspace``.

    Only ever acts on a ``(section_id, user_id)`` pair the report itself
    recorded, so an owner can't use this route to touch an unrelated grant.
    """
    match = next(
        (
            c
            for c in report.grant_changes
            if c.get("section_id") == section_id and c.get("user_id") == user_id
        ),
        None,
    )
    if match is None:
        raise NotFoundError("No such grant change on this report")

    section = db.get(Section, section_id)
    if section is None:
        raise NotFoundError("Section not found")

    result = widen_grant_to_workspace(
        db, workspace_id=section.workspace_id, section_id=section_id, user_id=user_id
    )
    with UnitOfWork(db):
        record_activity(
            db,
            workspace_id=section.workspace_id,
            actor=user,
            action="update",
            target_type="share",
            target_id=user_id,
            details={"widened_from_section_id": section_id, **result},
        )
    return result
