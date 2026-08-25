from sqlalchemy import (
    JSON,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, new_uuid, utcnow_iso


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(255))
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    # null = private; "viewer" = anyone with the link can read.
    public_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # bcrypt hash of the optional password gating anonymous public read access;
    # null = no password (open public link). Only meaningful when public_role is set.
    public_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Incremented whenever public access or its password changes so previously
    # issued unlock tokens are revoked immediately.
    public_access_version: Mapped[int] = mapped_column(Integer, default=0)
    # Set on ownership transfer; cleared on revert or next transfer.
    previous_owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    ownership_transferred_at: Mapped[str | None] = mapped_column(
        String(40), nullable=True
    )

    memberships: Mapped[list["WorkspaceMembership"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )
    invitations: Mapped[list["WorkspaceInvitation"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )


class WorkspaceMembership(Base):
    """Grants a non-owner user access to a tree (the "shared" half of the
    owned + shared access model)."""

    __tablename__ = "workspace_memberships"

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # "viewer" or "editor".
    role: Mapped[str] = mapped_column(String(20), default="editor")
    # List of domain keys the member may NOT see. None / [] = full access.
    restrictions: Mapped[list | None] = mapped_column(JSON, nullable=True)

    workspace: Mapped["Workspace"] = relationship(back_populates="memberships")


class WorkspaceUserState(Base):
    """Per-user "recently opened" timestamp for a tree.

    Kept separate from ``Workspace`` (rather than a single shared column) so that
    one collaborator opening a shared tree does not reorder another
    collaborator's — or the owner's — recent-tree list (#878).
    """

    __tablename__ = "workspace_user_states"

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    last_opened: Mapped[str] = mapped_column(String(40))


class WorkspaceInvitation(Base):
    """Token-based invite that grants tree access before or after account creation."""

    __tablename__ = "workspace_invitations"
    __table_args__ = (
        # Same composite-FK pattern as ``ContentScope``/``WorkspaceSectionGrant``:
        # the DB rejects a scope pointing into another workspace. NULL
        # ``section_id`` (the default, unscoped invitation) is left unchecked
        # by MATCH SIMPLE semantics. RESTRICT, like every other scope FK here
        # — an invitation row survives its own resolution
        # (accepted/revoked/expired) purely for status history, so
        # ``delete_section`` explicitly clears a *resolved* one's
        # ``section_id`` first rather than relying on implicit cascading
        # semantics; a still-*pending* invitation keeps blocking the delete.
        ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            ondelete="RESTRICT",
            name="fk_workspace_invitations_section",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="editor")
    # None = the workspace-wide grant an acceptance creates/upgrades (the
    # default for every invitation before #993). A section id scopes the
    # grant an acceptance creates to that section instead — see
    # ``app.services.collaboration.invitations.accept_invitation``.
    section_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE")
    )
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    expires_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    accepted_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    accepted_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    revoked_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    workspace: Mapped["Workspace"] = relationship(back_populates="invitations")


class WorkspaceSectionGrant(Base):
    """A user's role/restrictions scoped to one section (#993).

    Independent of any workspace-wide ``WorkspaceMembership`` row for the
    same user: a collaborator may hold both, or several section grants with
    different roles/restrictions, because the v1 model they are migrated
    from could grant different access on each constituent tree. Role and
    restrictions are always read from one grant together — never combined
    across two grants for the same user (see
    ``app.services.workspaces.grants``).
    """

    __tablename__ = "workspace_section_grants"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "user_id", "section_id", name="uq_section_grant_scope"
        ),
        ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            ondelete="RESTRICT",
            name="fk_section_grants_section",
        ),
        Index("ix_section_grants_workspace_user", "workspace_id", "user_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    section_id: Mapped[str] = mapped_column(String(36))
    # "viewer" or "editor".
    role: Mapped[str] = mapped_column(String(20), default="editor")
    # List of domain keys this grant does NOT see. None / [] = full access
    # within its scope.
    restrictions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Bumped on every role/restriction change so anything keyed to a grant's
    # identity (e.g. a future cached decision) can detect it changed.
    access_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)


class WorkspaceSectionPublicLink(Base):
    """An additional public read link scoped to one section (#993).

    Independent of the workspace-wide public link on ``Workspace``: several
    of these can coexist so consolidating same-owner trees preserves every
    legacy public link — each with its own password, role, and access
    version — instead of merging them into one more-permissive link.

    A row here is always live: revoking one deletes it (see
    ``app.services.workspaces.public_links.revoke_section_public_link``)
    rather than soft-marking it, mirroring ``WorkspaceSectionGrant`` — so a
    revoked link doesn't outlive its usefulness and permanently block its
    section from ever being deleted the way a merely-flagged row would.
    """

    __tablename__ = "workspace_section_public_links"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            ondelete="RESTRICT",
            name="fk_section_public_links_section",
        ),
        Index(
            "ix_section_public_links_workspace_section", "workspace_id", "section_id"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    section_id: Mapped[str] = mapped_column(String(36))
    # Only "viewer" is meaningful today (mirrors Workspace.public_role), kept
    # as a column rather than a boolean for parity with a future public role.
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    # bcrypt hash of this link's own password; null = no password.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Incremented on password change or revocation so previously issued
    # unlock tokens for *this* link stop working without affecting any other
    # link's tokens.
    access_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
