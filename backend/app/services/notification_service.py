"""Producer for the persistent per-user notification inbox.

Route handlers call ``create_notification`` after their own ``db.commit()``
to record a durable row and push it live over SSE. This must never break the
triggering request, so every failure is caught, logged, and rolled back here.
"""

import json
import logging
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Notification
from app.services import feature_service
from app.services.event_bus import event_bus

logger = logging.getLogger(__name__)

# Keep-last-N per user, enforced at insert time (no scheduler).
MAX_PER_USER = 100


def _serialize(n: Notification) -> dict[str, Any]:
    return {
        "id": n.id,
        "type": n.type,
        "payload": json.loads(n.payload) if n.payload else None,
        "created_at": n.created_at,
        "read_at": n.read_at,
    }


def create_notification(
    db: Session,
    user_id: str,
    type: str,
    payload: dict[str, Any] | None = None,
) -> None:
    """Persist a notification for user_id and push it live over SSE.

    Never raises — a failure here must not break the triggering request.
    """
    try:
        if not feature_service.is_enabled_for_id(db, "notifications", user_id):
            return
        n = Notification(
            user_id=user_id,
            type=type,
            payload=json.dumps(payload) if payload is not None else None,
        )
        db.add(n)
        db.flush()
        _enforce_retention(db, user_id)
        db.commit()
        db.refresh(n)
        event_bus.publish([user_id], "notification.created", _serialize(n))
    except Exception:
        logger.exception("create_notification failed (type=%s)", type)
        db.rollback()


def _enforce_retention(db: Session, user_id: str) -> None:
    keep_ids = db.scalars(
        select(Notification.id)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(MAX_PER_USER)
    ).all()
    if len(keep_ids) >= MAX_PER_USER:
        db.execute(
            delete(Notification).where(
                Notification.user_id == user_id,
                Notification.id.not_in(keep_ids),
            )
        )
