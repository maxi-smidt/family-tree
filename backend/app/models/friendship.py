from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow_iso


class Friendship(Base):
    """A directed friend relationship between two users.

    ``requester_id`` is whoever sent the pending request; once ``accepted`` the
    relationship is symmetric. There is at most one row per *unordered* pair —
    the composite primary key enforces it for a given ordering and the service
    layer always looks up both orderings before inserting.

    A tree may only be shared with a registered user when an ``accepted``
    friendship exists between the owner and that user.
    """

    __tablename__ = "friendships"

    requester_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    addressee_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # "pending" | "accepted" | "declined" | "blocked".
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    responded_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    __table_args__ = (
        Index("ix_friendships_requester_id", "requester_id"),
        Index("ix_friendships_addressee_id", "addressee_id"),
    )
