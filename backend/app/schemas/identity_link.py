"""Schemas for identity links (#985) — see app.services.identity_links."""

from pydantic import BaseModel, Field


class ProposeIdentityLinkRequest(BaseModel):
    target_workspace_id: str
    target_member_id: str


class DecideIdentityLinkRequest(BaseModel):
    # Matches IdentityLink.decision_reason (String(500)) so an over-length
    # value is rejected as a 422 here instead of failing the write.
    reason: str | None = Field(default=None, max_length=500)


class RejectIdentityLinkRequest(DecideIdentityLinkRequest):
    # Also blocks the proposer from proposing further links into the
    # rejecting side's workspace.
    block_proposer: bool = False


class IdentityLinkEndpointOut(BaseModel):
    workspace_id: str
    workspace_name: str
    member_id: str
    display_name: str | None


class IdentityLinkOut(BaseModel):
    id: str
    status: str
    verification_basis: str
    self: IdentityLinkEndpointOut
    # None when the counterpart is degraded to a protected placeholder because
    # the viewer currently lacks read access to that workspace (#985) — the
    # link itself is untouched, only this rendering hides who it points to.
    counterpart: IdentityLinkEndpointOut | None
    counterpart_protected: bool
    proposed_at: str
    expires_at: str | None
    verified_at: str | None
    decided_at: str | None
    decision_reason: str | None


class IdentityLinkListOut(BaseModel):
    links: list[IdentityLinkOut]


class ProposeIdentityLinkClaimRequest(BaseModel):
    # An accepted friend's username — never a workspace or member id, so the
    # proposer never needs (or gets) any visibility into the target's
    # workspace (#1014's opaque claim/invitation flow).
    target_username: str = Field(min_length=1, max_length=100)
    # Free text about the proposer's *own* member, shown to the target to
    # help them decide — never anything read from the target's workspace.
    note: str | None = Field(default=None, max_length=500)


class CompleteIdentityLinkClaimRequest(BaseModel):
    workspace_id: str
    member_id: str


class DecideIdentityLinkClaimRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class IdentityLinkClaimOut(BaseModel):
    id: str
    status: str
    source_workspace_id: str
    source_workspace_name: str
    source_member_id: str
    source_display_name: str | None
    proposer_username: str | None
    target_username: str
    note: str | None
    created_at: str
    expires_at: str | None
    decided_at: str | None
    decision_reason: str | None
    resulting_identity_link_id: str | None


class IdentityLinkClaimListOut(BaseModel):
    claims: list[IdentityLinkClaimOut]
