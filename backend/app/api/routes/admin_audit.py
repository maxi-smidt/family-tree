"""Read-only administrator audit API.

The trail is deliberately append-only: there is no create, update or delete
route, so administrators (and this API) can never rewrite history. Entries are
paginated with a total count, filterable, and exportable to CSV for durable,
off-instance archival. See ``docs/SECURITY.md`` for retention, access and
tamper-protection expectations.
"""

import csv
import io
import json
import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models.admin_audit import AdminAuditLog
from app.schemas.admin_audit import AdminAuditOut, AdminAuditPage

router = APIRouter(
    prefix="/admin/audit-log",
    tags=["admin-audit"],
    dependencies=[Depends(require_admin)],
)

_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _end_bound(end: str) -> str:
    """Make a date-only ``end`` inclusive of the whole day.

    Timestamps are stored as ISO-8601 UTC strings, which sort lexicographically,
    so a bare ``YYYY-MM-DD`` upper bound would exclude everything on that day.
    Extending it to the end of the day keeps the filter intuitive.
    """
    if _DATE_ONLY.match(end):
        return f"{end}T23:59:59.999999+00:00"
    return end


def _audit_filters(
    *,
    action: str | None,
    subject_type: str | None,
    actor: str | None,
    start: str | None,
    end: str | None,
) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = []
    if action:
        conditions.append(AdminAuditLog.action == action)
    if subject_type:
        conditions.append(AdminAuditLog.subject_type == subject_type)
    if actor:
        conditions.append(AdminAuditLog.actor_username.ilike(f"%{actor}%"))
    if start:
        conditions.append(AdminAuditLog.created_at >= start)
    if end:
        conditions.append(AdminAuditLog.created_at <= _end_bound(end))
    return conditions


@router.get("", response_model=AdminAuditPage)
def list_admin_audit_log(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None),
    subject_type: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> AdminAuditPage:
    """Return a page of entries, newest first, plus the total for these filters.

    Combined with ``offset`` this keeps every older entry reachable instead of
    only the newest page. This trail deliberately has no write API.
    """
    conditions = _audit_filters(
        action=action, subject_type=subject_type, actor=actor, start=start, end=end
    )
    total = db.scalar(
        select(func.count()).select_from(AdminAuditLog).where(*conditions)
    )
    items = list(
        db.scalars(
            select(AdminAuditLog)
            .where(*conditions)
            .order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc())
            .offset(offset)
            .limit(limit)
        ).all()
    )
    return AdminAuditPage(
        items=[AdminAuditOut.model_validate(item) for item in items],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.get("/subject-types", response_model=list[str])
def list_audit_subject_types(db: Session = Depends(get_db)) -> list[str]:
    """Distinct subject types present in the trail, for the filter dropdown."""
    return list(
        db.scalars(
            select(AdminAuditLog.subject_type)
            .distinct()
            .order_by(AdminAuditLog.subject_type)
        ).all()
    )


_CSV_COLUMNS = (
    "created_at",
    "actor_username",
    "actor_id",
    "action",
    "subject_type",
    "subject_id",
    "subject_label",
    "details",
    "id",
)


@router.get("/export")
def export_admin_audit_log(
    action: str | None = Query(default=None),
    subject_type: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> Response:
    """Export every entry matching the filters as CSV for durable archival.

    Unlike the paginated list this is not capped, so the whole trail can be
    preserved outside the database (its retention is otherwise the operator's
    responsibility).
    """
    conditions = _audit_filters(
        action=action, subject_type=subject_type, actor=actor, start=start, end=end
    )
    rows = db.scalars(
        select(AdminAuditLog)
        .where(*conditions)
        .order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc())
    ).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(_CSV_COLUMNS)
    for row in rows:
        writer.writerow(
            [
                row.created_at,
                row.actor_username,
                row.actor_id,
                row.action,
                row.subject_type,
                row.subject_id,
                row.subject_label,
                json.dumps(row.details, ensure_ascii=False) if row.details else "",
                row.id,
            ]
        )

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="admin-audit-{stamp}.csv"'
        },
    )
