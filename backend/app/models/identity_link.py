"""Identity links: verified cross-workspace equivalence between two members.

Replaces the legacy tree-in-tree bridge (``Member.linked_workspace_id`` /
``linked_member_id``, removed by #1021) with a normalized, consent-driven
model. A link is **not transitive**: it states that exactly the
two named members are the same person, and says nothing about any other link
either of them may separately hold. This keeps the "at most one member from a
given workspace represented twice" invariant trivial to enforce — it already
follows from ``ck_identity_link_no_same_workspace`` below, since a link's
"identity component" is always just its own two endpoints.

Endpoints are canonically ordered (``member_a_id < member_b_id``) so the same
unordered pair can never be represented by two rows, regardless of which side
proposed the link. ``app.services.identity_links`` is the only writer and owns
maintaining that order across every mutation (including a member merge that
repoints an endpoint).

Fields are never mirrored across a link (contrast the legacy bridge's
field-mirroring) — a link only asserts identity, it never copies data.
"""

from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class IdentityLinkStatus(StrEnum):
    PROPOSED = "proposed"
    VERIFIED = "verified"
    REJECTED = "rejected"
    EXPIRED = "expired"
    REVOKED = "revoked"


class IdentityLinkVerificationBasis(StrEnum):
    # Both current workspace owners explicitly approved.
    MUTUAL_CONSENT = "mutual_consent"
    # One actor owns (or administers) both workspaces at proposal time.
    SAME_OWNER = "same_owner"
    # Converted from a legacy bridge person at migration time — created by one
    # actor who had write access to both trees, not necessarily approval from
    # both current owners. See ``alembic/versions/v2_0_0_identity_links.py``.
    LEGACY_DUAL_WRITE_ACCESS = "legacy_dual_write_access"


class IdentityLinkAction(StrEnum):
    PROPOSE = "propose"
    APPROVE = "approve"
    REJECT = "reject"
    REVOKE = "revoke"
    EXPIRE = "expire"
    # System-authored: a legacy bridge pair converted by
    # alembic/versions/v2_0_0_identity_links.py, not a user action.
    MIGRATE = "migrate"


class IdentityLink(Base):
    __tablename__ = "identity_links"
    __table_args__ = (
        UniqueConstraint("member_a_id", "member_b_id", name="uq_identity_link_pair"),
        CheckConstraint(
            "workspace_a_id <> workspace_b_id", name="ck_identity_link_no_same_workspace"
        ),
        # Also rules out member_a_id == member_b_id (a member can't equal itself
        # in a strict "<" order), so no separate self-link check is needed.
        CheckConstraint(
            "member_a_id < member_b_id", name="ck_identity_link_canonical_order"
        ),
        # Deferred to transaction-commit: app.services.migration.converter
        # briefly has a link naming a member's about-to-be-vacated workspace
        # while consolidating a same-owner component chaining 3+ workspaces
        # together — see alembic/versions/v2_0_0_defer_identity_link_fks.py.
        ForeignKeyConstraint(
            ["workspace_a_id", "member_a_id"],
            ["members.workspace_id", "members.id"],
            ondelete="CASCADE",
            name="fk_identity_link_member_a",
            deferrable=True,
            initially="DEFERRED",
        ),
        ForeignKeyConstraint(
            ["workspace_b_id", "member_b_id"],
            ["members.workspace_id", "members.id"],
            ondelete="CASCADE",
            name="fk_identity_link_member_b",
            deferrable=True,
            initially="DEFERRED",
        ),
        Index("ix_identity_links_workspace_a", "workspace_a_id"),
        Index("ix_identity_links_workspace_b", "workspace_b_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    member_a_id: Mapped[str] = mapped_column(String(36), index=True)
    member_b_id: Mapped[str] = mapped_column(String(36), index=True)
    workspace_a_id: Mapped[str] = mapped_column(String(36))
    workspace_b_id: Mapped[str] = mapped_column(String(36))

    status: Mapped[str] = mapped_column(String(20), default=IdentityLinkStatus.PROPOSED)
    verification_basis: Mapped[str] = mapped_column(String(30))

    proposed_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    proposed_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    # Only meaningful while status == "proposed"; a background sweep expires
    # rows past this (see app.services.system.deletion_sweeper).
    expires_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # Per-workspace approval, recorded separately so a durable trail survives
    # whichever side proposed. Auto-filled for the proposer's own side (and
    # both sides at once for verification_basis="same_owner").
    approved_by_a: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at_a: Mapped[str | None] = mapped_column(String(40), nullable=True)
    approved_by_b: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at_b: Mapped[str | None] = mapped_column(String(40), nullable=True)
    verified_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # The terminal decision for rejected/expired/revoked (decided_by is None
    # for a system expiry).
    decided_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # SQLAlchemy's optimistic-concurrency column: every UPDATE through the ORM
    # is conditioned on this value and bumps it, raising StaleDataError if a
    # concurrent propose/approve/reject/revoke already moved the row (mapped
    # to a 409 by the identity-links routes). See app.services.identity_links.
    version: Mapped[int] = mapped_column(Integer, default=0)

    __mapper_args__ = {"version_id_col": version}


class IdentityLinkEvent(Base):
    """Immutable per-transition audit trail for one identity link."""

    __tablename__ = "identity_link_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    identity_link_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("identity_links.id", ondelete="CASCADE"), index=True
    )
    action: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso, index=True)


class IdentityLinkBlock(Base):
    """A workspace owner blocking a specific user from proposing further links
    into their workspace (e.g. after rejecting an unwanted proposal)."""

    __tablename__ = "identity_link_blocks"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "blocked_user_id", name="uq_identity_link_block"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    blocked_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)


class IdentityLinkIdempotencyKey(Base):
    """Dedupes a retried propose/approve/reject/revoke call.

    Keyed by the acting user + action + a client-supplied key (the
    ``Idempotency-Key`` header) so a double-submit or network retry replays
    the first call's result instead of raising a duplicate-state error.
    """

    __tablename__ = "identity_link_idempotency_keys"

    actor_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    action: Mapped[str] = mapped_column(String(20), primary_key=True)
    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    identity_link_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("identity_links.id", ondelete="CASCADE")
    )
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
