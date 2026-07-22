"""Persistent per-user notification inbox (friend/tree/social events)."""

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    # No standalone index: the composite (user_id, created_at) below covers
    # every user_id-prefixed query and the FK cascade lookup.
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE")
    )
    # snake_case, no dots — see notification_service.py for the registry.
    type: Mapped[str] = mapped_column(String(50))
    # JSON-encoded dict, or NULL. Keys double as i18n interpolation vars.
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    read_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    __table_args__ = (
        # newest-first per-user paging + unread scans
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )
