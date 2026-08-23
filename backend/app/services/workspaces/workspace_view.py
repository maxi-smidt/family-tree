"""Workspace -> WorkspaceOut serialization, shared by private/public routes."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import User, Workspace, WorkspaceMembership
from app.schemas.workspace import WorkspaceOut
from app.services.workspace_roles import role_for
from app.services.workspaces.workspace_state import workspace_last_opened


class _Unset:
    """Sentinel type so ``None`` remains a valid explicit ``last_opened`` value."""


_UNSET = _Unset()


def tree_out(
    db: Session,
    tree: Workspace,
    user: User | None,
    shared_count: int | None = None,
    last_opened: str | None | _Unset = _UNSET,
) -> WorkspaceOut:
    out = WorkspaceOut.model_validate(tree)
    out.role = role_for(db, tree, user) if user is not None else "viewer"
    if shared_count is None:
        shared_count = db.scalar(
            select(func.count())
            .select_from(WorkspaceMembership)
            .where(WorkspaceMembership.workspace_id == tree.id)
        )
    out.shared_count = shared_count or 0
    if user is not None and out.role not in ("owner",) and not user.is_admin:
        membership = db.get(WorkspaceMembership, (tree.id, user.id))
        out.restrictions = list(membership.restrictions or []) if membership else []
    out.public_password_protected = tree.public_password_hash is not None
    if isinstance(last_opened, _Unset):
        last_opened = (
            workspace_last_opened(db, tree.id, user.id) if user is not None else None
        )
    out.last_opened = last_opened
    return out
