"""Cross-tree member search for authenticated users."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import explicit_workspace_ids, get_current_user
from app.db.session import get_db
from app.models import Member, User, Workspace
from app.schemas.family import MemberSearchHitOut
from app.services.members.member_search import (
    MEMBER_SURFACE_COLUMNS,
    member_name_search_clause,
)

router = APIRouter(tags=["search"])


@router.get("/search", response_model=list[MemberSearchHitOut])
def search_members_across_trees(
    q: str = Query(..., min_length=1, max_length=200),
    exclude_workspace_id: str | None = Query(None),
    per_tree_limit: int = Query(8, ge=1, le=20),
    limit: int = Query(40, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search every owned or explicitly shared tree the caller can read.

    The current tree can be excluded so the UI presents its local matches first
    and never duplicates them in the "other workspaces" section. Per-tree and
    overall caps bound the response even when the caller can read many workspaces.
    """
    workspace_ids = [
        workspace_id
        for workspace_id in explicit_workspace_ids(db, user)
        if workspace_id != exclude_workspace_id
    ]
    if not workspace_ids:
        return []

    matched_members = (
        select(
            *MEMBER_SURFACE_COLUMNS,
            Member.workspace_id.label("workspace_id"),
            Workspace.name.label("workspace_name"),
            func.row_number()
            .over(
                partition_by=Member.workspace_id,
                order_by=(Member.last_name, Member.first_name, Member.id),
            )
            .label("tree_rank"),
        )
        .join(Workspace, Workspace.id == Member.workspace_id)
        .where(
            Member.workspace_id.in_(workspace_ids),
            member_name_search_clause(q),
        )
        .subquery()
    )
    rows = db.execute(
        select(matched_members)
        .where(matched_members.c.tree_rank <= per_tree_limit)
        .order_by(
            matched_members.c.workspace_name,
            matched_members.c.last_name,
            matched_members.c.first_name,
            matched_members.c.id,
        )
        .limit(limit)
    ).all()
    return [MemberSearchHitOut(**row._mapping) for row in rows]
