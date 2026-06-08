"""Activity / audit log endpoint — list recent changes for a tree."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_tree
from app.db.session import get_db
from app.models import Tree
from app.models.activity import ActivityLog
from app.schemas.activity import ActivityOut

router = APIRouter(prefix="/trees/{tree_id}", tags=["activity"])


@router.get("/activity", response_model=list[ActivityOut])
def list_activity(
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    """Return the 200 most-recent activity-log entries for a tree.

    Accessible to anyone with at least read access (owner, editor, viewer).
    """
    return db.scalars(
        select(ActivityLog)
        .where(ActivityLog.tree_id == tree.id)
        .order_by(ActivityLog.created_at.desc())
        .limit(200)
    ).all()
