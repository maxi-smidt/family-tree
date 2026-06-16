from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    false,
)
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
    matches_computed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    sources: Mapped[list["VirtualViewSource"]] = relationship(
        back_populates="view",
        cascade="all, delete-orphan",
        order_by="VirtualViewSource.position",
        foreign_keys="VirtualViewSource.view_id",
    )
    matches: Mapped[list["VirtualViewMemberMatch"]] = relationship(
        cascade="all, delete-orphan",
    )
    positions: Mapped[list["VirtualViewPosition"]] = relationship(
        cascade="all, delete-orphan",
    )


class VirtualViewSource(Base):
    """A source of a virtual view — either a real tree or another virtual view.

    Exactly one of ``tree_id`` / ``source_view_id`` is set (enforced by a check
    constraint). ``ON DELETE CASCADE`` on both FKs means deleting a source tree
    *or* a nested source view drops this row, so the parent view naturally falls
    below its 2-source minimum and reports ``virtual_view_sources_missing``.

    Nesting is pure sugar: a virtual view's sources are flattened to the
    underlying real ``tree_id``s (see ``services/virtual_view_sources.py``), so
    a view over ``{A, vv1}`` with ``vv1 = {B, C}`` behaves exactly like ``{A, B,
    C}``.
    """

    __tablename__ = "virtual_view_sources"
    __table_args__ = (
        CheckConstraint(
            "(tree_id IS NULL) <> (source_view_id IS NULL)",
            name="ck_vvs_exactly_one_source",
        ),
    )

    view_id: Mapped[str] = mapped_column(
        String(40),
        ForeignKey("virtual_views.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # Positions are assigned 0..n per view (unique within a view), so they form
    # the rest of the primary key now that a source may be a tree or a view.
    position: Mapped[int] = mapped_column(Integer, primary_key=True, default=0)
    tree_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), nullable=True
    )
    source_view_id: Mapped[str | None] = mapped_column(
        String(40),
        ForeignKey("virtual_views.id", ondelete="CASCADE"),
        nullable=True,
    )

    view: Mapped["VirtualView"] = relationship(
        back_populates="sources", foreign_keys=[view_id]
    )


class VirtualViewMemberMatch(Base):
    """One row per member that belongs to a match group for a given view."""

    __tablename__ = "virtual_view_member_matches"
    __table_args__ = (Index("ix_vvmm_view_group", "view_id", "group_id"),)

    view_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("virtual_views.id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), primary_key=True
    )
    group_id: Mapped[str] = mapped_column(String(40), nullable=False)
    is_primary: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )


class VirtualViewPosition(Base):
    """Saved layout overlay for a virtual view (written by the align action)."""

    __tablename__ = "virtual_view_positions"

    view_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("virtual_views.id", ondelete="CASCADE"), primary_key=True
    )
    node_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)
