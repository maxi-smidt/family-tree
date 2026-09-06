"""Identity link routes: propose, approve, reject, revoke (#985).

Replaces the tree-in-tree bridge's single-actor link with per-workspace
consent — see ``app.services.identity_links`` for the lifecycle rules this
just wires up to HTTP.
"""

import math

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_workspace,
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
from app.models.identity_link import IdentityLink
from app.models.user import User
from app.schemas.identity_link import (
    DecideIdentityLinkRequest,
    IdentityLinkListOut,
    IdentityLinkOut,
    ProposeIdentityLinkRequest,
    RejectIdentityLinkRequest,
)
from app.services.identity_links import (
    approve_link,
    list_links_for_member,
    list_links_for_workspace,
    propose_link,
    reject_link,
    revoke_link,
    to_identity_link_out,
)
from app.services.members.member_access import get_member
from app.services.workspaces.visibility import (
    WorkspaceAccessContext,
    resolve_access_context,
)

router = APIRouter(tags=["identity-links"])


def _get_link_in_workspace(db: Session, tree: Workspace, link_id: str) -> IdentityLink:
    link = db.get(IdentityLink, link_id)
    if link is None or tree.id not in (link.workspace_a_id, link.workspace_b_id):
        raise NotFoundError("Identity link not found")
    return link


def _to_out_for_workspace(
    db: Session, link: IdentityLink, viewer: User, tree: Workspace
) -> IdentityLinkOut:
    """Render ``link`` from whichever side sits in ``tree`` — approve/reject/
    revoke act on the link as a whole rather than one named member."""
    member_id = link.member_a_id if link.workspace_a_id == tree.id else link.member_b_id
    member = db.get(Member, member_id)
    if member is None:
        raise NotFoundError("Identity link not found")
    return to_identity_link_out(db, link, viewer, member)


@router.get(
    "/workspaces/{workspace_id}/members/{member_id}/identity-links",
    response_model=IdentityLinkListOut,
)
def list_member_identity_links(
    member_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member = get_member(db, tree, member_id)
    context: WorkspaceAccessContext = resolve_access_context(db, tree, user)
    if not context.can_read_member(db, member.id):
        raise HTTPException(status_code=404, detail="Member not found")
    return IdentityLinkListOut(links=list_links_for_member(db, user, member))


@router.get(
    "/workspaces/{workspace_id}/identity-links",
    response_model=IdentityLinkListOut,
)
def list_workspace_identity_links(
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every link touching this workspace, for its owner to review (#1014)."""
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can review identity links"
        )
    return IdentityLinkListOut(links=list_links_for_workspace(db, user, tree))


@router.post(
    "/workspaces/{workspace_id}/members/{member_id}/identity-links",
    response_model=IdentityLinkOut,
    status_code=201,
)
def propose_identity_link(
    member_id: str,
    payload: ProposeIdentityLinkRequest,
    request: Request,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    member = get_member(db, tree, member_id)
    context.require_write_member(db, member.id)

    target_workspace = db.get(Workspace, payload.target_workspace_id)
    target_member = (
        db.get(Member, payload.target_member_id) if target_workspace is not None else None
    )
    if (
        target_workspace is None
        or target_member is None
        or target_member.workspace_id != target_workspace.id
    ):
        # Same exception type, status, and message propose_link itself raises
        # for "exists but unreadable/blocked" — a missing target must be
        # indistinguishable from one the caller simply can't see (#985).
        raise AccessDeniedError("Cannot propose a link to this member")

    ip = client_ip(request) or "unknown"
    limiter_key = f"{user.id}:{target_workspace.id}"
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

    link = propose_link(
        db,
        user,
        tree,
        member,
        target_workspace,
        target_member,
        idempotency_key=idempotency_key,
    )
    return to_identity_link_out(db, link, user, member)


@router.post(
    "/workspaces/{workspace_id}/identity-links/{link_id}/approve",
    response_model=IdentityLinkOut,
)
def approve_identity_link(
    link_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    link = _get_link_in_workspace(db, tree, link_id)
    link = approve_link(db, user, link, idempotency_key=idempotency_key)
    return _to_out_for_workspace(db, link, user, tree)


@router.post(
    "/workspaces/{workspace_id}/identity-links/{link_id}/reject",
    response_model=IdentityLinkOut,
)
def reject_identity_link(
    link_id: str,
    payload: RejectIdentityLinkRequest,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    link = _get_link_in_workspace(db, tree, link_id)
    link = reject_link(
        db,
        user,
        link,
        reason=payload.reason,
        block_proposer=payload.block_proposer,
        idempotency_key=idempotency_key,
    )
    return _to_out_for_workspace(db, link, user, tree)


@router.post(
    "/workspaces/{workspace_id}/identity-links/{link_id}/revoke",
    response_model=IdentityLinkOut,
)
def revoke_identity_link(
    link_id: str,
    payload: DecideIdentityLinkRequest,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    link = _get_link_in_workspace(db, tree, link_id)
    link = revoke_link(
        db, user, link, reason=payload.reason, idempotency_key=idempotency_key
    )
    return _to_out_for_workspace(db, link, user, tree)
