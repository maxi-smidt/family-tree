"""Core genealogy tables.

Member columns intentionally keep the camelCase names used by the original
SQLite schema so the JSON contract with the existing React frontend is
preserved 1:1.
"""

from sqlalchemy import Boolean, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Member(Base):
    __tablename__ = "members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )

    gender: Mapped[str | None] = mapped_column(String(1), nullable=True)
    firstName: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lastName: Mapped[str | None] = mapped_column(String(255), nullable=True)
    maidenName: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Relative media URL (e.g. /api/media/<tree>/<file>) or null.
    imageData: Mapped[str | None] = mapped_column(Text, nullable=True)
    dateOfBirth: Mapped[str | None] = mapped_column(String(40), nullable=True)
    dateOfDeath: Mapped[str | None] = mapped_column(String(40), nullable=True)
    additionalData: Mapped[str | None] = mapped_column(Text, nullable=True)
    isCollapsed: Mapped[bool] = mapped_column(Boolean, default=False)
    positionX: Mapped[float] = mapped_column(Float, default=0)
    positionY: Mapped[float] = mapped_column(Float, default=0)


class Relation(Base):
    __tablename__ = "relations"

    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), primary_key=True
    )
    from_member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), primary_key=True
    )
    to_member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), primary_key=True
    )
    relation_type: Mapped[str] = mapped_column(String(50), primary_key=True)


class RelationType(Base):
    """The set of relation types available within a single tree."""

    __tablename__ = "relation_types"

    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)


class MemberDisease(Base):
    __tablename__ = "member_diseases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    carrier_status: Mapped[str] = mapped_column(String(50))
    inheritance_pattern: Mapped[str] = mapped_column(String(50), default="unknown")
    diagnosis_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
