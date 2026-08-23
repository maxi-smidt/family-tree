"""Helpers for tree invitation acceptance logic."""

from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.models import User, WorkspaceInvitation, WorkspaceMembership
from app.services.unit_of_work import UnitOfWork


def _invitation_status(inv: WorkspaceInvitation, now: str) -> str:
    if inv.revoked_at is not None:
        return "revoked"
    if inv.accepted_at is not None:
        return "accepted"
    if inv.expires_at is not None and inv.expires_at < now:
        return "expired"
    return "pending"


def is_invitation_valid(inv: WorkspaceInvitation) -> bool:
    return _invitation_status(inv, utcnow_iso()) == "pending"


def invitation_status(inv: WorkspaceInvitation) -> str:
    return _invitation_status(inv, utcnow_iso())


def accept_invitation(
    db: Session, inv: WorkspaceInvitation, user: User
) -> WorkspaceMembership:
    """Upsert membership from invite; never downgrades an existing higher role."""
    _RANK = {"viewer": 0, "editor": 1, "owner": 2}
    invite_rank = _RANK.get(inv.role, 0)

    membership = db.get(WorkspaceMembership, (inv.workspace_id, user.id))
    with UnitOfWork(db):
        if membership is None and inv.workspace_id != user.id:
            # Don't add a membership if the user owns the tree.
            from app.models import Workspace

            tree = db.get(Workspace, inv.workspace_id)
            if tree is None or tree.owner_id != user.id:
                membership = WorkspaceMembership(
                    workspace_id=inv.workspace_id, user_id=user.id, role=inv.role
                )
                db.add(membership)
        elif membership is not None:
            existing_rank = _RANK.get(membership.role, 0)
            if invite_rank > existing_rank:
                membership.role = inv.role

        inv.accepted_at = utcnow_iso()
        inv.accepted_by = user.id

    if membership is not None:
        db.refresh(membership)
    return membership
