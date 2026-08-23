"""A user's role on a tree — shared by API dependencies and services."""

from sqlalchemy.orm import Session

from app.models import User, Workspace, WorkspaceMembership


def role_for(db: Session, tree: Workspace, user: User) -> str | None:
    """The user's genuine relationship to the tree: 'owner' | 'editor' |
    'viewer', or None when they have no explicit access.

    Admin god-mode is intentionally NOT applied here: an admin who has been
    granted access to someone else's tree should see their real role (e.g.
    editor) instead of appearing as the owner. Admin authorization is enforced
    separately in ``_resolve_workspace``. Admins with no explicit grant still fall
    back to 'owner' so every tree they can see lands in a sensible bucket.
    """
    if tree.owner_id == user.id:
        return "owner"
    membership = db.get(WorkspaceMembership, (tree.id, user.id))
    if membership:
        return membership.role
    return "owner" if user.is_admin else None
