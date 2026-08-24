"""Instance-wide audit entries that are intentionally independent of workspaces."""

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class AdminAuditLog(Base):
    """Durable audit trail for administrative and account-level mutations."""

    __tablename__ = "admin_audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    actor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(20))
    subject_type: Mapped[str] = mapped_column(String(40), index=True)
    subject_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subject_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso, index=True)
