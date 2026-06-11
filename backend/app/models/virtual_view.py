from uuid import uuid4

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, utcnow_iso


class VirtualView(Base):
    __tablename__ = "virtual_views"

    id: Mapped[str] = mapped_column(
        String(40), primary_key=True, default=lambda: f"vv_{uuid4()}"
    )
    name: Mapped[str] = mapped_column(String(255))
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    last_opened: Mapped[str | None] = mapped_column(String(40), nullable=True)

    sources: Mapped[list["VirtualViewSource"]] = relationship(
        back_populates="view",
        cascade="all, delete-orphan",
        order_by="VirtualViewSource.position",
    )


class VirtualViewSource(Base):
    __tablename__ = "virtual_view_sources"

    view_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("virtual_views.id", ondelete="CASCADE"), primary_key=True
    )
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)

    view: Mapped["VirtualView"] = relationship(back_populates="sources")
