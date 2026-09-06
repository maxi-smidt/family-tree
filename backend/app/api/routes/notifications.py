"""Persistent per-user notification inbox routes.

User-scoped only (no workspace_id) — see ``notification_service.py`` for the
producer side that writes these rows from other routers.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import Notification, User
from app.schemas.notification import NotificationOut, NotificationPageOut
from app.services.unit_of_work import UnitOfWork

router = APIRouter(
    prefix="/notifications",
    tags=["notifications"],
)


def _to_out(n: Notification) -> NotificationOut:
    return NotificationOut(
        id=n.id,
        type=n.type,
        payload=json.loads(n.payload) if n.payload else None,
        created_at=n.created_at,
        read_at=n.read_at,
    )


@router.get("", response_model=NotificationPageOut)
def list_notifications(
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationPageOut:
    total = (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id)
        )
        or 0
    )
    unread_count = (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        )
        or 0
    )
    rows = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return NotificationPageOut(
        entries=[_to_out(row) for row in rows],
        total=total,
        unread_count=unread_count,
    )


@router.get("/unread-count")
def get_unread_count(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    unread_count = (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        )
        or 0
    )
    return {"unread_count": unread_count}


@router.post("/{notification_id}/read", status_code=204)
def mark_read(
    notification_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    if n.read_at is None:
        with UnitOfWork(db):
            n.read_at = utcnow_iso()


@router.post("/read-all", status_code=204)
def mark_all_read(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    with UnitOfWork(db):
        db.execute(
            update(Notification)
            .where(Notification.user_id == user.id, Notification.read_at.is_(None))
            .values(read_at=utcnow_iso())
        )
