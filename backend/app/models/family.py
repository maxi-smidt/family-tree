"""Core genealogy tables.

Member columns intentionally use camelCase names so the JSON contract with
the React frontend (`MemberDB` & friends) is preserved 1:1.
"""

from sqlalchemy import Boolean, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db.base import Base


class Member(Base):
    __tablename__ = "members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
    )

    gender: Mapped[str | None] = mapped_column(String(1), nullable=True)
    academicTitle: Mapped[str | None] = mapped_column(String(100), nullable=True)
    firstName: Mapped[str | None] = mapped_column(String(255), nullable=True)
    middleNames: Mapped[str | None] = mapped_column(String(255), nullable=True)
    baptismalName: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lastName: Mapped[str | None] = mapped_column(String(255), nullable=True)
    maidenName: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Relative media URL (e.g. /api/media/<tree>/<file>) or null.
    imageData: Mapped[str | None] = mapped_column(Text, nullable=True)
    dateOfBirth: Mapped[str | None] = mapped_column(String(40), nullable=True)
    dateOfDeath: Mapped[str | None] = mapped_column(String(40), nullable=True)
    dateOfBirthSort: Mapped[str | None] = mapped_column(
        String(10), nullable=True, index=True
    )
    dateOfDeathSort: Mapped[str | None] = mapped_column(
        String(10), nullable=True, index=True
    )
    additionalData: Mapped[str | None] = mapped_column(Text, nullable=True)
    birthplace: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hometown: Mapped[str | None] = mapped_column(String(255), nullable=True)
    placesLived: Mapped[str | None] = mapped_column(Text, nullable=True)
    deceased: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    isCollapsed: Mapped[bool] = mapped_column(Boolean, default=False)
    positionX: Mapped[float] = mapped_column(Float, default=0)
    positionY: Mapped[float] = mapped_column(Float, default=0)

    @validates("dateOfBirth", "dateOfDeath")
    def _derive_date_sort(self, key: str, value: str | None) -> str | None:
        """Automatically keep the ``*Sort`` columns in sync with date changes.

        Called by SQLAlchemy whenever ``dateOfBirth`` or ``dateOfDeath`` is
        assigned, including on ``__init__``, ``setattr``-based updates, and
        bulk-attribute updates.  The sort key is derived lazily to avoid an
        import at module load time.
        """
        # Lazy import to prevent any potential circular-import issues at
        # module load time (genealogy_date has no DB imports, but being
        # defensive is cheap here).
        from app.services.genealogy_date import sort_key  # noqa: PLC0415

        setattr(self, f"{key}Sort", sort_key(value))
        return value


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
    """Instance-wide registry of relation types, managed by admins."""

    __tablename__ = "relation_types"

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
