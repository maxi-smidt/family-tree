"""Helpers for tree invitation acceptance logic."""

from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.models import TreeInvitation, TreeMembership, User


def _invitation_status(inv: TreeInvitation, now: str) -> str:
    if inv.revoked_at is not None:
        return "revoked"
    if inv.accepted_at is not None:
        return "accepted"
    if inv.expires_at is not None and inv.expires_at < now:
        return "expired"
    return "pending"


def is_invitation_valid(inv: TreeInvitation) -> bool:
    return _invitation_status(inv, utcnow_iso()) == "pending"


def invitation_status(inv: TreeInvitation) -> str:
    return _invitation_status(inv, utcnow_iso())


def accept_invitation(db: Session, inv: TreeInvitation, user: User) -> TreeMembership:
    """Upsert membership from invite; never downgrades an existing higher role."""
    _RANK = {"viewer": 0, "editor": 1, "owner": 2}
    invite_rank = _RANK.get(inv.role, 0)

    membership = db.get(TreeMembership, (inv.tree_id, user.id))
    if membership is None and inv.tree_id != user.id:
        # Don't add a membership if the user owns the tree.
        from app.models import Tree

        tree = db.get(Tree, inv.tree_id)
        if tree is None or tree.owner_id != user.id:
            membership = TreeMembership(
                tree_id=inv.tree_id, user_id=user.id, role=inv.role
            )
            db.add(membership)
    elif membership is not None:
        existing_rank = _RANK.get(membership.role, 0)
        if invite_rank > existing_rank:
            membership.role = inv.role

    now = utcnow_iso()
    inv.accepted_at = now
    inv.accepted_by = user.id
    db.commit()

    if membership is not None:
        db.refresh(membership)
    return membership
