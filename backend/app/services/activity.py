"""Lightweight helper for recording activity-log entries.

Usage inside a mutation route (before the existing db.commit()):

    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="create",
        target_type="member",
        target_id=member.id,
        target_label="Ada Doe",
    )
    db.commit()

The helper only calls ``db.add(...)``; it does NOT commit so the new row
participates in the route's own transaction and is rolled back on error.
"""

import json

from sqlalchemy.orm import Session

from app.models.activity import ActivityLog
from app.models.user import User


def record_activity(
    db: Session,
    *,
    tree_id: str,
    actor: User,
    action: str,
    target_type: str,
    target_id: str | None = None,
    target_label: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        ActivityLog(
            tree_id=tree_id,
            actor_id=actor.id,
            actor_username=actor.username,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_label=target_label,
            details=json.dumps(details) if details is not None else None,
        )
    )
