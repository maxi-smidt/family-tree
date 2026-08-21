"""Per-user "last opened" bookkeeping for trees (#878)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.db.upsert import upsert_row
from app.models.tree import TreeUserState


def mark_tree_opened(db: Session, tree_id: str, user_id: str) -> None:
    """Stamp ``tree_id`` as just-opened for ``user_id``."""
    upsert_row(
        db,
        TreeUserState,
        {"tree_id": tree_id, "user_id": user_id, "last_opened": utcnow_iso()},
        index_elements=["tree_id", "user_id"],
    )


def bulk_tree_last_opened(
    db: Session, tree_ids: list[str], user_id: str
) -> dict[str, str]:
    """This user's last-opened stamp for each of ``tree_ids`` that has one."""
    if not tree_ids:
        return {}
    return dict(
        db.execute(
            select(TreeUserState.tree_id, TreeUserState.last_opened).where(
                TreeUserState.user_id == user_id,
                TreeUserState.tree_id.in_(tree_ids),
            )
        ).all()
    )


def tree_last_opened(db: Session, tree_id: str, user_id: str) -> str | None:
    return bulk_tree_last_opened(db, [tree_id], user_id).get(tree_id)
