"""Helpers for the instance-wide, read-only administrator audit trail."""

from sqlalchemy.orm import Session

from app.models.admin_audit import AdminAuditLog
from app.models.user import User
from app.services.admin_audit_details import AdminAuditDetails


def record_admin_audit(
    db: Session,
    *,
    actor: User | None,
    action: str,
    subject_type: str,
    subject_id: str | None = None,
    subject_label: str | None = None,
    details: AdminAuditDetails | None = None,
) -> None:
    """Stage an audit row in the caller's current transaction.

    Passwords, tokens, TOTP secrets, and other credentials must never be put
    in ``details``.  The caller remains responsible for committing.
    """
    db.add(
        AdminAuditLog(
            actor_id=actor.id if actor else None,
            actor_username=actor.username if actor else "system",
            action=action,
            subject_type=subject_type,
            subject_id=subject_id,
            subject_label=subject_label,
            details=details,
        )
    )
