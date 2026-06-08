"""Activity / audit log — records who changed what on a tree."""

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class ActivityLog(Base):
    __tablename__ = "activity_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )
    # actor_id is nullable so that log rows survive user deletion.
    actor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Snapshot of the username at the time of the action — survives user deletion.
    actor_username: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # "create" | "update" | "delete"
    action: Mapped[str] = mapped_column(String(20))
    # "member" | "relation" | "event" | "story" | "gallery_image" | "disease"
    target_type: Mapped[str] = mapped_column(String(40))
    # nullable because relations use a composite key
    target_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # human-readable snapshot (member name, story title, …)
    target_label: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso, index=True)
