"""Core genealogy tables."""

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
    academic_title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    middle_names: Mapped[str | None] = mapped_column(String(255), nullable=True)
    baptismal_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    maiden_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Relative media URL (e.g. /api/media/<tree>/<file>) or null.
    image_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_of_birth: Mapped[str | None] = mapped_column(String(40), nullable=True)
    date_of_death: Mapped[str | None] = mapped_column(String(40), nullable=True)
    date_of_birth_sort: Mapped[str | None] = mapped_column(
        String(10), nullable=True, index=True
    )
    date_of_death_sort: Mapped[str | None] = mapped_column(
        String(10), nullable=True, index=True
    )
    additional_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    birthplace: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hometown: Mapped[str | None] = mapped_column(String(255), nullable=True)
    places_lived: Mapped[str | None] = mapped_column(Text, nullable=True)
    deceased: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_collapsed: Mapped[bool] = mapped_column(Boolean, default=False)
    position_x: Mapped[float] = mapped_column(Float, default=0)
    position_y: Mapped[float] = mapped_column(Float, default=0)

    @validates("date_of_birth", "date_of_death")
    def _derive_date_sort(self, key: str, value: str | None) -> str | None:
        """Automatically keep the ``*_sort`` columns in sync with date changes.

        Called by SQLAlchemy whenever ``date_of_birth`` or ``date_of_death`` is
        assigned, including on ``__init__``, ``setattr``-based updates, and
        bulk-attribute updates.  The sort key is derived lazily to avoid an
        import at module load time.
        """
        # Lazy import to prevent any potential circular-import issues at
        # module load time (genealogy_date has no DB imports, but being
        # defensive is cheap here).
        from app.services.genealogy_date import sort_key  # noqa: PLC0415

        setattr(self, f"{key}_sort", sort_key(value))
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
