"""Shared logic for scheduling user account deletion."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models import User
from app.services import settings_service


def schedule_deletion(db: Session, user: User, requested_by: str) -> None:
    """Mark ``user`` for deletion after the configured grace period.

    Idempotent: if deletion is already scheduled, the existing deadline is kept.
    ``requested_by`` is the ID of the actor — an admin's ID for admin-initiated
    deletion, or the user's own ID for self-service deletion.
    """
    if user.deletion_requested_at is not None:
        return
    now = datetime.now(UTC)
    grace_days = settings_service.get_int_setting(
        db,
        "deletion_grace_period_days",
        settings_service.DEFAULT_DELETION_GRACE_PERIOD_DAYS,
    )
    user.deletion_requested_at = now.isoformat()
    user.deletion_scheduled_for = (now + timedelta(days=grace_days)).isoformat()
    user.deletion_requested_by = requested_by
    db.commit()
    db.refresh(user)
