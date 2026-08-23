from sqlalchemy import JSON, ForeignKey, Integer, String
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="editor")
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
