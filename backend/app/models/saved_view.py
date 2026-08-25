"""Saved views: named canvas arrangements over one workspace's canonical graph.

Unlike ``VirtualView`` (multiple trees stitched into one composite graph), a
saved view lives inside a single workspace and never serves its own content —
it only stores a *configuration* (focus member, included sections, traversal
depths, filters) that the frontend replays against the canonical bounded
graph API (``GET /workspaces/{id}/members/neighborhood``) and the ordinary
member/content endpoints. A view is owned by its creator, like today's
``VirtualView``.

``version`` drives SQLAlchemy's optimistic-concurrency check (see
``__mapper_args__``): a concurrent edit against a stale copy raises
``StaleDataError`` instead of silently clobbering the other writer's change.
"""

from __future__ import annotations

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, new_uuid, utcnow_iso

# Bumped whenever the shape of ``filters`` (or another config field) changes
# in a backwards-incompatible way, so a reader can tell an old row apart from
# one written under a newer schema.
SAVED_VIEW_CONFIG_VERSION = 1


class SavedView(Base):
    __tablename__ = "saved_views"
    __table_args__ = (
        # The parent key ``SavedViewSection`` points at, so the database
        # rejects a section membership row for a section outside this view's
        # own workspace (mirrors ``Section.uq_section_workspace_id_id``).
        UniqueConstraint("workspace_id", "id", name="uq_saved_view_workspace_id_id"),
        # A composite FK against ``members (workspace_id, id)`` so a focus
        # member can never belong to another workspace. RESTRICT keeps member
        # deletion from silently invalidating this pointer — the delete route
        # explicitly clears ``focus_member_id`` to NULL first (degrading the
        # view rather than losing it); RESTRICT is only the backstop for a
        # path that skips that repair.
        ForeignKeyConstraint(
            ["workspace_id", "focus_member_id"],
            ["members.workspace_id", "members.id"],
            ondelete="RESTRICT",
            name="fk_saved_views_focus_member",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(40), primary_key=True, default=lambda: f"sv_{new_uuid()}"
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    focus_member_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    ancestor_depth: Mapped[int] = mapped_column(Integer, default=3)
    descendant_depth: Mapped[int] = mapped_column(Integer, default=3)
    include_partners: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    # Reserved for filter criteria beyond the section list (which lives in
    # ``SavedViewSection``) — empty until a concrete filter needs it.
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    config_version: Mapped[int] = mapped_column(
        Integer, default=SAVED_VIEW_CONFIG_VERSION
    )
    version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)

    __mapper_args__ = {"version_id_col": version}

    sections: Mapped[list[SavedViewSection]] = relationship(
        cascade="all, delete-orphan"
    )
    positions: Mapped[list[SavedViewPosition]] = relationship(
        cascade="all, delete-orphan"
    )
    user_states: Mapped[list[SavedViewUserState]] = relationship(
        cascade="all, delete-orphan"
    )


class SavedViewSection(Base):
    """One section included in a saved view's traversal filter.

    ``workspace_id`` is denormalized from the owning ``SavedView`` (immutable
    once written) purely so this table can carry the same composite
    same-workspace FK every other section-scoped table does.
    """

    __tablename__ = "saved_view_sections"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            ondelete="RESTRICT",
            name="fk_saved_view_sections_section",
        ),
    )

    saved_view_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("saved_views.id", ondelete="CASCADE"), primary_key=True
    )
    section_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(36))


class SavedViewPosition(Base):
    """Canvas layout overlay for a saved view.

    ``node_id`` is usually a real member id; see
    ``app.services.saved_views.position_conversion`` for the synthetic
    match-group anchor ids a virtual-view conversion (#987) may also write
    here.
    """

    __tablename__ = "saved_view_positions"

    saved_view_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("saved_views.id", ondelete="CASCADE"), primary_key=True
    )
    node_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)


class SavedViewUserState(Base):
    """Per-user ephemeral state for a saved view: last-opened stamp plus the
    camera/collapse state of the canvas — never part of the shared
    configuration, and never shown to another viewer."""

    __tablename__ = "saved_view_user_states"

    saved_view_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("saved_views.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    last_opened: Mapped[str] = mapped_column(String(40))
    camera_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    camera_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    camera_zoom: Mapped[float | None] = mapped_column(Float, nullable=True)
    collapsed_node_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
