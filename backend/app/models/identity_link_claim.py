"""Identity link claims: the opaque half of #1014's proposal flow.

``app.services.identity_links.propose_link`` requires the proposer to already
read the target member — fine when both workspaces are mutually readable, but
proposing a link into a friend's private workspace can't name a member the
proposer has never seen. A claim covers that case: the proposer names only
their own member and the *target user* (an accepted friend); that user then
picks which of their own members (in any workspace they own) the claim
resolves to. Nothing about the target's workspace is ever requested from or
disclosed to the proposer — see ``app.services.identity_link_claims``.

Completing a claim hands off to the same ``IdentityLink`` row a direct
proposal would create (see ``app.models.identity_link``), so once resolved a
claim and a direct proposal are indistinguishable in the link's own history.
"""

from enum import StrEnum

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class IdentityLinkClaimStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    DECLINED = "declined"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class IdentityLinkClaim(Base):
    __tablename__ = "identity_link_claims"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)

    source_member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("members.id", ondelete="CASCADE"), index=True
    )
    proposed_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Captured at creation time when the proposer already owned the source
    # workspace, so that consent survives onto the resulting IdentityLink
    # without re-asking once the target picks their member (see
    # ``app.services.identity_link_claims.complete_claim``).
    source_approved_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    source_approved_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    target_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # The proposer's own free-text hint, shown only to the target — never
    # data read from the target's workspace.
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    status: Mapped[str] = mapped_column(
        String(20), default=IdentityLinkClaimStatus.PENDING
    )
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    expires_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    resulting_identity_link_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("identity_links.id", ondelete="SET NULL"), nullable=True
    )
    decided_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Optimistic concurrency, same rationale as IdentityLink.version.
    version: Mapped[int] = mapped_column(Integer, default=0)

    __mapper_args__ = {"version_id_col": version}
