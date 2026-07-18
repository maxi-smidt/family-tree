"""Cross-tree member search for authenticated users."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import explicit_tree_ids, get_current_user
from app.db.session import get_db
from app.models import Member, Tree, User
from app.schemas.family import MemberSearchHitOut
from app.services.member_search import MEMBER_SURFACE_COLUMNS, member_name_search_clause

router = APIRouter(tags=["search"])


@router.get("/search", response_model=list[MemberSearchHitOut])
def search_members_across_trees(
    q: str = Query(..., min_length=1, max_length=200),
    exclude_tree_id: str | None = Query(None),
    per_tree_limit: int = Query(8, ge=1, le=20),
    limit: int = Query(40, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search every owned or explicitly shared tree the caller can read.

    The current tree can be excluded so the UI presents its local matches first
    and never duplicates them in the "other trees" section. Per-tree and
    overall caps bound the response even when the caller can read many trees.
    """
    tree_ids = [
        tree_id
        for tree_id in explicit_tree_ids(db, user)
        if tree_id != exclude_tree_id
    ]
    if not tree_ids:
        return []

    matched_members = (
        select(
            *MEMBER_SURFACE_COLUMNS,
            Member.tree_id.label("tree_id"),
            Tree.name.label("tree_name"),
            func.row_number()
            .over(
                partition_by=Member.tree_id,
                order_by=(Member.last_name, Member.first_name, Member.id),
            )
            .label("tree_rank"),
        )
        .join(Tree, Tree.id == Member.tree_id)
        .where(
            Member.tree_id.in_(tree_ids),
            member_name_search_clause(q),
        )
        .subquery()
    )
    rows = db.execute(
        select(matched_members)
        .where(matched_members.c.tree_rank <= per_tree_limit)
        .order_by(
            matched_members.c.tree_name,
            matched_members.c.last_name,
            matched_members.c.first_name,
            matched_members.c.id,
        )
        .limit(limit)
    ).all()
    return [MemberSearchHitOut(**row._mapping) for row in rows]
