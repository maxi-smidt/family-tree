"""Cross-tree member search for authenticated users."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import explicit_workspace_ids, get_current_user
from app.db.session import get_db
from app.models import Member, User, Workspace
from app.schemas.family import MemberSearchHitOut
from app.services.members.member_search import (
    MEMBER_SURFACE_COLUMNS,
    member_name_search_clause,
)
from app.services.workspaces.visibility import resolve_access_context

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

    A caller whose only access to a workspace is a section-scoped grant (#993)
    must not match members outside their granted sections there — the same
    boundary ``WorkspaceAccessContext.member_filter()`` (#984) enforces on the
    tree-scoped search, applied per candidate workspace since each can bind a
    different grant.
    """
    workspaces = {
        workspace.id: workspace
        for workspace in db.scalars(
            select(Workspace).where(
                Workspace.id.in_(explicit_workspace_ids(db, user)),
                Workspace.id != exclude_workspace_id,
            )
        )
    }
    if not workspaces:
        return []

    per_workspace_filters = []
    for workspace_id, workspace in workspaces.items():
        context = resolve_access_context(db, workspace, user)
        member_filter = context.member_filter()
        clause = Member.workspace_id == workspace_id
        if member_filter is not None:
            clause = clause & member_filter
        per_workspace_filters.append(clause)

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
        .where(or_(*per_workspace_filters), member_name_search_clause(q))
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
