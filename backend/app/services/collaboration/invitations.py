"""Helpers for tree invitation acceptance logic."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.models import (
    User,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
    WorkspaceSectionGrant,
)
from app.services.unit_of_work import UnitOfWork

_ROLE_RANK = {"viewer": 0, "editor": 1, "owner": 2}


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
) -> WorkspaceMembership | WorkspaceSectionGrant | None:
    """Upsert the grant an invite names; never downgrades an existing higher
    role, and never merges into a grant of a *different* scope (#993): a
    section-scoped invite only ever creates/upgrades that section's grant, a
    workspace-wide invite only ever creates/upgrades the workspace-wide one.
    """
    invite_rank = _ROLE_RANK.get(inv.role, 0)
    result: WorkspaceMembership | WorkspaceSectionGrant | None

    with UnitOfWork(db):
        if inv.section_id is not None:
            grant = db.scalar(
                select(WorkspaceSectionGrant).where(
                    WorkspaceSectionGrant.workspace_id == inv.workspace_id,
                    WorkspaceSectionGrant.user_id == user.id,
                    WorkspaceSectionGrant.section_id == inv.section_id,
                )
            )
            if grant is None:
                grant = WorkspaceSectionGrant(
                    workspace_id=inv.workspace_id,
                    user_id=user.id,
                    section_id=inv.section_id,
                    role=inv.role,
                )
                db.add(grant)
            elif invite_rank > _ROLE_RANK.get(grant.role, 0):
                grant.role = inv.role
            result = grant
        else:
            membership = db.get(WorkspaceMembership, (inv.workspace_id, user.id))
            if membership is None:
                tree = db.get(Workspace, inv.workspace_id)
                if tree is None or tree.owner_id != user.id:
                    # Don't add a membership if the user owns the tree.
                    membership = WorkspaceMembership(
                        workspace_id=inv.workspace_id, user_id=user.id, role=inv.role
                    )
                    db.add(membership)
            elif invite_rank > _ROLE_RANK.get(membership.role, 0):
                membership.role = inv.role
            result = membership

        inv.accepted_at = utcnow_iso()
        inv.accepted_by = user.id

    if result is not None:
        db.refresh(result)
    return result
