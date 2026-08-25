"""Schemas for identity links (#985) — see app.services.identity_links."""

from pydantic import BaseModel


class ProposeIdentityLinkRequest(BaseModel):
    target_workspace_id: str
    target_member_id: str


class DecideIdentityLinkRequest(BaseModel):
    reason: str | None = None


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
