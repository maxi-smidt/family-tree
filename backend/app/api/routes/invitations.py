"""Workspace invitation routes and global invite-accept endpoints."""

import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_current_user_optional,
    get_readable_workspace,
)
from app.db.session import get_db
from app.models import User, Workspace, WorkspaceInvitation
from app.schemas.notification import InvitationReceivedPayload
from app.schemas.workspace import (
    InvitationAcceptResult,
    InvitationCreate,
    InvitationOut,
    InvitationPreview,
)
from app.services.collaboration import notification_service
from app.services.collaboration.invitations import (
    accept_invitation,
    invitation_status,
    is_invitation_valid,
)
from app.services.event_bus import event_bus
from app.services.unit_of_work import UnitOfWork

router = APIRouter(tags=["invitations"])


def _inv_out(inv: WorkspaceInvitation, *, include_token: bool = False) -> InvitationOut:
    out = InvitationOut.model_validate(inv)
    out.status = invitation_status(inv)
    if not include_token:
        out.token = None
    return out


# ---------------------------------------------------------------------------
# Per-tree invitation management (owner only)
# ---------------------------------------------------------------------------


@router.get(
    "/workspaces/{workspace_id}/invitations",
    response_model=list[InvitationOut],
)
def list_invitations(
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can manage invitations"
        )
    invitations = db.scalars(
        select(WorkspaceInvitation)
        .where(WorkspaceInvitation.workspace_id == tree.id)
        .order_by(WorkspaceInvitation.created_at.desc())
    ).all()
    return [_inv_out(inv, include_token=True) for inv in invitations]


@router.post(
    "/workspaces/{workspace_id}/invitations",
    response_model=InvitationOut,
    status_code=201,
)
def create_invitation(
    payload: InvitationCreate,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can create invitations"
        )
    if payload.role not in ("viewer", "editor"):
        raise HTTPException(status_code=400, detail="Invalid role")

    expires_at = None
    if payload.expires_in_days is not None:
        expires_at = (
            datetime.now(UTC) + timedelta(days=payload.expires_in_days)
        ).isoformat()

    inv = WorkspaceInvitation(
        workspace_id=tree.id,
        token=secrets.token_urlsafe(32),
        email=payload.email,
        role=payload.role,
        created_by=user.id,
        expires_at=expires_at,
    )

    def _notify_invited_user() -> None:
        if not payload.email:
            return
        invited_user = db.scalar(
            select(User).where(
                User.email == payload.email,
                User.is_active.is_(True),
                User.deletion_requested_at.is_(None),
            )
        )
        if invited_user is not None:
            event_bus.publish(
                [invited_user.id],
                "invitation.received",
                {"workspace_id": tree.id, "workspace_name": tree.name},
            )
            notification_service.create_notification(
                db,
                invited_user.id,
                "invitation_received",
                InvitationReceivedPayload(workspace_id=tree.id, workspace_name=tree.name),
            )

    with UnitOfWork(db) as uow:
        db.add(inv)
        uow.after_commit(_notify_invited_user)
    db.refresh(inv)
    return _inv_out(inv, include_token=True)


@router.delete(
    "/workspaces/{workspace_id}/invitations/{invitation_id}",
    status_code=204,
)
def revoke_invitation(
    invitation_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can revoke invitations"
        )
    inv = db.get(WorkspaceInvitation, invitation_id)
    if inv is None or inv.workspace_id != tree.id:
        raise HTTPException(status_code=404, detail="Invitation not found")
    from app.db.base import utcnow_iso

    with UnitOfWork(db):
        inv.revoked_at = utcnow_iso()


# ---------------------------------------------------------------------------
# Global accept routes (not tree-scoped — invitee may not yet have access)
# ---------------------------------------------------------------------------

global_router = APIRouter(prefix="/invites", tags=["invitations"])


@global_router.get("/{token}", response_model=InvitationPreview)
def preview_invite(
    token: str,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Return basic info about an invitation without revealing tree content."""
    inv = db.scalar(select(WorkspaceInvitation).where(WorkspaceInvitation.token == token))
    if inv is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    tree = db.get(Workspace, inv.workspace_id)
    return InvitationPreview(
        workspace_name=tree.name if tree else "",
        role=inv.role,
        valid=is_invitation_valid(inv),
        requires_account=user is None,
    )


@global_router.post("/{token}/accept", response_model=InvitationAcceptResult)
def accept_invite(
    token: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    inv = db.scalar(select(WorkspaceInvitation).where(WorkspaceInvitation.token == token))
    if inv is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if not is_invitation_valid(inv):
        status_val = invitation_status(inv)
        raise HTTPException(
            status_code=409,
            detail=f"Invitation is {status_val}",
        )
    tree = db.get(Workspace, inv.workspace_id)
    if tree is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    accept_invitation(db, inv, user)
    return InvitationAcceptResult(
        workspace_id=tree.id,
        workspace_name=tree.name,
        role=inv.role,
    )
