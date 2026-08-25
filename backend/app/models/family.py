"""Core genealogy tables."""

from sqlalchemy import Boolean, Float, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db.base import Base


class Member(Base):
    __tablename__ = "members"
    __table_args__ = (
        # Redundant as a uniqueness rule (``id`` is already the PK), but it is
        # the parent key ``IdentityLink`` points at, letting the database
        # reject a link whose endpoint's workspace doesn't match the member it
        # names — see ``models.identity_link.IdentityLink``.
        UniqueConstraint("workspace_id", "id", name="uq_member_workspace_id_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
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
    cemetery: Mapped[str | None] = mapped_column(String(255), nullable=True)
    places_lived: Mapped[str | None] = mapped_column(Text, nullable=True)
    deceased: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    adopted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_collapsed: Mapped[bool] = mapped_column(Boolean, default=False)
    # Optional pointer to another tree that details this person's own family
    # (the "tree-in-tree" link). SET NULL so deleting the target tree just
    # clears the link rather than cascading.
    linked_workspace_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # The counterpart row in the linked tree representing the same person (the
    # "bridge person"). Navigation into the linked tree centers on it. SET NULL
    # so deleting the counterpart degrades the link to tree-level only.
    linked_member_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("members.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
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
        from app.services.interchange.gedcom.genealogy_date import (
            sort_key,  # noqa: PLC0415
        )

        setattr(self, f"{key}_sort", sort_key(value))
        return value


class Relation(Base):
    __tablename__ = "relations"
    __table_args__ = (
        # The neighborhood traversal steps a generation at a time, filtering by
        # workspace + relation type on one endpoint at a time; these keep both
        # directions an index lookup instead of a scan (#983).
        Index(
            "ix_relations_workspace_type_from",
            "workspace_id",
            "relation_type",
            "from_member_id",
        ),
        Index(
            "ix_relations_workspace_type_to",
            "workspace_id",
            "relation_type",
            "to_member_id",
        ),
    )

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
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
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    color: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stroke_width: Mapped[float | None] = mapped_column(Float, nullable=True)
    stroke_dasharray: Mapped[str | None] = mapped_column(String(32), nullable=True)


class MemberDisease(Base):
    __tablename__ = "member_diseases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    carrier_status: Mapped[str] = mapped_column(String(50))
    inheritance_pattern: Mapped[str] = mapped_column(String(50), default="unknown")
    diagnosis_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
