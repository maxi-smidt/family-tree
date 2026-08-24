"""Sections: named, overlapping organizational branches inside a workspace.

Membership (``SectionMember``) is an explicit assignment, never derived —
see ``app.services.sections``. ``SectionPosition`` is the per-section layout
overlay: the same person can sit at a different canvas position in each
section they belong to.
"""

from sqlalchemy import Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.db.base import Base, new_uuid, utcnow_iso


class Section(Base):
    __tablename__ = "sections"
    __table_args__ = (
        # Enforced on ``name_normalized`` (not ``name``) so the DB — not just
        # the service-layer pre-check — rejects two concurrent inserts that
        # differ only by case/whitespace.
        UniqueConstraint(
            "workspace_id", "name_normalized", name="uq_section_workspace_name"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    # Derived from ``name`` (see ``_derive_name_normalized`` below); never set
    # directly.
    name_normalized: Mapped[str] = mapped_column(String(255))
    # Display order among a workspace's sections. Assigned append-only at
    # creation (next highest value); a client may PATCH it to reorder.
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)

    @validates("name")
    def _derive_name_normalized(self, _key: str, value: str) -> str:
        self.name_normalized = value.strip().lower()
        return value

    members: Mapped[list["SectionMember"]] = relationship(
        back_populates="section", cascade="all, delete-orphan"
    )
    positions: Mapped[list["SectionPosition"]] = relationship(
        cascade="all, delete-orphan"
    )


class SectionMember(Base):
    __tablename__ = "section_members"

    section_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sections.id", ondelete="CASCADE"), primary_key=True
    )
    # Indexed on its own (in addition to being the composite PK's second
    # column) so "which sections is this member in" is as cheap as "who is
    # in this section".
    member_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("members.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )

    section: Mapped["Section"] = relationship(back_populates="members")


class SectionPosition(Base):
    """A member's canvas position within one section's layout overlay."""

    __tablename__ = "section_positions"

    section_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sections.id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), primary_key=True
    )
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)
