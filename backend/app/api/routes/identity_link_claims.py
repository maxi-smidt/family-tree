"""Identity link claim routes — the opaque half of #1014's proposal flow.

See ``app.services.identity_link_claims`` for why a claim exists alongside a
direct ``propose_identity_link`` (#985): it lets a caller who cannot read the
target workspace still propose a link, by naming only an accepted friend
rather than a specific member.
"""

import math

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_workspace_access_write,
    get_writable_workspace,
)
from app.core.exceptions import AccessDeniedError, NotFoundError
from app.core.rate_limit import (
    identity_link_propose_aggregate_rate_limiter,
    identity_link_propose_rate_limiter,
)
from app.core.request_ip import client_ip
from app.db.session import get_db
from app.models import Member, Workspace
from app.models.identity_link_claim import IdentityLinkClaim
from app.models.user import User
from app.schemas.identity_link import (
    CompleteIdentityLinkClaimRequest,
    DecideIdentityLinkClaimRequest,
    IdentityLinkClaimListOut,
    IdentityLinkClaimOut,
    IdentityLinkOut,
    ProposeIdentityLinkClaimRequest,
)
from app.services.identity_link_claims import (
    cancel_claim,
    complete_claim,
    decline_claim,
    list_claims_for_member,
    list_incoming_claims,
    list_outgoing_claims,
    propose_claim,
    to_claim_out,
)
from app.services.identity_links import to_identity_link_out
from app.services.members.member_access import get_member
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(tags=["identity-link-claims"])


def _get_claim_for_source(
    db: Session, tree: Workspace, claim_id: str
) -> IdentityLinkClaim:
    claim = db.get(IdentityLinkClaim, claim_id)
    if claim is None:
        raise NotFoundError("Identity link claim not found")
    member = db.get(Member, claim.source_member_id)
    if member is None or member.workspace_id != tree.id:
        raise NotFoundError("Identity link claim not found")
    return claim


@router.post(
    "/workspaces/{workspace_id}/members/{member_id}/identity-link-claims",
    response_model=IdentityLinkClaimOut,
    status_code=201,
)
def propose_identity_link_claim(
    member_id: str,
    payload: ProposeIdentityLinkClaimRequest,
    request: Request,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    member = get_member(db, tree, member_id)
    context.require_write_member(db, member.id)

    ip = client_ip(request) or "unknown"
    limiter_key = f"{user.id}:{payload.target_username.strip().lower()}"
    retry_after = identity_link_propose_rate_limiter.retry_after(limiter_key)
    aggregate_retry_after = identity_link_propose_aggregate_rate_limiter.retry_after(ip)
    if retry_after is not None or aggregate_retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many identity link proposals; try again later",
            headers={
                "Retry-After": str(
                    max(1, math.ceil(max(retry_after or 0, aggregate_retry_after or 0)))
                )
            },
        )
    identity_link_propose_rate_limiter.record_hit(limiter_key)
    identity_link_propose_aggregate_rate_limiter.record_hit(ip)

    claim = propose_claim(
        db, user, tree, member, payload.target_username, note=payload.note
    )
    return to_claim_out(db, claim)


@router.get(
    "/workspaces/{workspace_id}/members/{member_id}/identity-link-claims",
    response_model=IdentityLinkClaimListOut,
)
def list_member_identity_link_claims(
    member_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    member = get_member(db, tree, member_id)
    context.require_write_member(db, member.id)
    return IdentityLinkClaimListOut(
        claims=[to_claim_out(db, c) for c in list_claims_for_member(db, member)]
    )


@router.post(
    "/workspaces/{workspace_id}/identity-link-claims/{claim_id}/cancel",
    response_model=IdentityLinkClaimOut,
)
def cancel_identity_link_claim(
    claim_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    claim = _get_claim_for_source(db, tree, claim_id)
    claim = cancel_claim(db, user, claim)
    return to_claim_out(db, claim)


@router.get("/identity-link-claims/incoming", response_model=IdentityLinkClaimListOut)
def list_incoming_identity_link_claims(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return IdentityLinkClaimListOut(
        claims=[to_claim_out(db, c) for c in list_incoming_claims(db, user)]
    )


@router.get("/identity-link-claims/outgoing", response_model=IdentityLinkClaimListOut)
def list_outgoing_identity_link_claims(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return IdentityLinkClaimListOut(
        claims=[to_claim_out(db, c) for c in list_outgoing_claims(db, user)]
    )


@router.post(
    "/identity-link-claims/{claim_id}/decline", response_model=IdentityLinkClaimOut
)
def decline_identity_link_claim(
    claim_id: str,
    payload: DecideIdentityLinkClaimRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    claim = db.get(IdentityLinkClaim, claim_id)
    if claim is None or claim.target_user_id != user.id:
        raise NotFoundError("Identity link claim not found")
    claim = decline_claim(db, user, claim, reason=payload.reason)
    return to_claim_out(db, claim)


@router.post("/identity-link-claims/{claim_id}/complete", response_model=IdentityLinkOut)
def complete_identity_link_claim(
    claim_id: str,
    payload: CompleteIdentityLinkClaimRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    claim = db.get(IdentityLinkClaim, claim_id)
    if claim is None or claim.target_user_id != user.id:
        raise NotFoundError("Identity link claim not found")

    target_workspace = db.get(Workspace, payload.workspace_id)
    if target_workspace is None or (
        target_workspace.owner_id != user.id and not user.is_admin
    ):
        raise AccessDeniedError(
            "Only a workspace owner may complete an identity link claim"
        )
    target_member = get_member(db, target_workspace, payload.member_id)

    link = complete_claim(db, user, claim, target_workspace, target_member)
    return to_identity_link_out(db, link, user, target_member)
