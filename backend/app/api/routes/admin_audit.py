"""Read-only administrator audit API."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models.admin_audit import AdminAuditLog
from app.schemas.admin_audit import AdminAuditOut

router = APIRouter(
    prefix="/admin/audit-log",
    tags=["admin-audit"],
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=list[AdminAuditOut])
def list_admin_audit_log(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[AdminAuditLog]:
    """Return newest entries first; this trail deliberately has no write API."""
    return list(
        db.scalars(
            select(AdminAuditLog)
            .order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc())
            .offset(offset)
            .limit(limit)
        ).all()
    )
