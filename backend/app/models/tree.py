from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, new_uuid, utcnow_iso


class Tree(Base):
    __tablename__ = "trees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(255))
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    last_opened: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # null = private; "viewer" = anyone with the link can read.
    public_role: Mapped[str | None] = mapped_column(String(20), nullable=True)

    memberships: Mapped[list["TreeMembership"]] = relationship(
        back_populates="tree", cascade="all, delete-orphan"
    )
    invitations: Mapped[list["TreeInvitation"]] = relationship(
        back_populates="tree", cascade="all, delete-orphan"
    )


class TreeMembership(Base):
    """Grants a non-owner user access to a tree (the "shared" half of the
    owned + shared access model)."""

    __tablename__ = "tree_memberships"

    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # "viewer" or "editor".
    role: Mapped[str] = mapped_column(String(20), default="editor")

    tree: Mapped["Tree"] = relationship(back_populates="memberships")


class TreeInvitation(Base):
    """Token-based invite that grants tree access before or after account creation."""

    __tablename__ = "tree_invitations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), index=True
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

    tree: Mapped["Tree"] = relationship(back_populates="invitations")
