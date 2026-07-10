"""Activity / audit log endpoint — list recent changes for a tree."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.activity_query import activity_page
from app.api.deps import get_readable_tree, require_feature
from app.db.session import get_db
from app.models import Tree
from app.schemas.activity import ActivityPageOut

router = APIRouter(
    prefix="/trees/{tree_id}",
    tags=["activity"],
    dependencies=[Depends(require_feature("activity_log"))],
)


@router.get("/activity", response_model=ActivityPageOut)
def list_activity(
    tree: Tree = Depends(get_readable_tree),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    actor: str | None = Query(default=None),
    action: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> ActivityPageOut:
    """Return an offset-based page of newest-first activity for a tree.

    Accessible to anyone with at least read access (owner, editor, viewer).
    """
    return activity_page(
        db,
        [tree.id],
        limit=limit,
        offset=offset,
        actor=actor,
        action=action,
        target_type=target_type,
    )
