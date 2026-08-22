"""Tree -> TreeOut serialization, shared by the private and public tree routes."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import role_for
from app.models import Tree, TreeMembership, User
from app.schemas.tree import TreeOut
from app.services.tree_state import tree_last_opened


class _Unset:
    """Sentinel type so ``None`` remains a valid explicit ``last_opened`` value."""


_UNSET = _Unset()


def tree_out(
    db: Session,
    tree: Tree,
    user: User | None,
    shared_count: int | None = None,
    last_opened: str | None | _Unset = _UNSET,
) -> TreeOut:
    out = TreeOut.model_validate(tree)
    out.role = role_for(db, tree, user) if user is not None else "viewer"
    if shared_count is None:
        shared_count = db.scalar(
            select(func.count())
            .select_from(TreeMembership)
            .where(TreeMembership.tree_id == tree.id)
        )
    out.shared_count = shared_count or 0
    if user is not None and out.role not in ("owner",) and not user.is_admin:
        membership = db.get(TreeMembership, (tree.id, user.id))
        out.restrictions = list(membership.restrictions or []) if membership else []
    out.public_password_protected = tree.public_password_hash is not None
    if isinstance(last_opened, _Unset):
        last_opened = tree_last_opened(db, tree.id, user.id) if user is not None else None
    out.last_opened = last_opened
    return out
