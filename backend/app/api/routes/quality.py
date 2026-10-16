"""Data-quality report endpoint."""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_workspace,
    get_workspace_access_authenticated,
    get_workspace_access_write,
    get_writable_workspace,
)
from app.db.session import get_db
from app.models import ContentType, User, Workspace
from app.models.content import Event, EventMemberLink
from app.models.family import Member, Relation
from app.models.quality import QualityIssueDismissal
from app.schemas.quality import QualityReport
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.quality_checks import run_quality_checks
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["quality"],
)


def _visible_issues(db: Session, tree: Workspace, context: WorkspaceAccessContext):
    statement = select(Member).where(Member.workspace_id == tree.id)
    member_filter = context.member_filter()
    if member_filter is not None:
        statement = statement.where(member_filter)
    members = list(db.scalars(statement).all())
    visible_ids = {m.id for m in members}
    relations = list(
        db.scalars(
            select(Relation).where(
                Relation.workspace_id == tree.id,
                Relation.from_member_id.in_(visible_ids),
                Relation.to_member_id.in_(visible_ids),
            )
        ).all()
    )
    events = []
    if context.is_owner_or_admin or any(
        "events" not in grant.restrictions for grant in context.grants
    ):
        event_query = select(Event).where(Event.workspace_id == tree.id)
        content_filter = context.content_filter(
            ContentType.EVENT, Event.id, domain="events"
        )
        if content_filter is not None:
            event_query = event_query.where(content_filter)
        events = list(db.scalars(event_query).all())
    event_links = list(
        db.scalars(
            select(EventMemberLink).where(
                EventMemberLink.event_id.in_([event.id for event in events]),
                EventMemberLink.member_id.in_(visible_ids),
            )
        ).all()
    )
    return members, run_quality_checks(members, relations, events, event_links)


@router.get("/quality-report", response_model=QualityReport)
def get_quality_report(
    include_dismissed: bool = False,
    tree: Workspace = Depends(get_readable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_authenticated),
    db: Session = Depends(get_db),
):
    """Return a non-destructive data-quality report for the tree.

    Accessible to anyone with at least read access. Dismissed issues are
    excluded by default; pass ``include_dismissed=true`` to get the full
    list with each issue's ``dismissed`` flag set.
    """
    members, raw_issues = _visible_issues(db, tree, context)

    dismissed_ids = set(
        db.scalars(
            select(QualityIssueDismissal.issue_id).where(
                QualityIssueDismissal.workspace_id == tree.id
            )
        ).all()
    )

    issues = [
        i.model_copy(update={"dismissed": i.id in dismissed_ids}) for i in raw_issues
    ]
    if not include_dismissed:
        issues = [i for i in issues if not i.dismissed]

    return QualityReport(
        workspace_id=tree.id,
        total_members=len(members),
        issues=issues,
    )


@router.post("/quality-report/issues/{issue_id}/dismiss", status_code=204)
def dismiss_quality_issue(
    issue_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Dismiss a quality issue so it no longer shows up by default.

    The issue must currently exist (i.e. be produced by the live checks) to
    be dismissable. Dismissals are tree-scoped and shared by every editor.
    """
    _, raw_issues = _visible_issues(db, tree, context)
    issue = next((i for i in raw_issues if i.id == issue_id), None)
    if issue is None:
        raise HTTPException(status_code=404, detail="Quality issue not found")
    for member_id in issue.member_ids:
        context.require_write_member(db, member_id, mode="delete")
    existing = db.scalar(
        select(QualityIssueDismissal).where(
            QualityIssueDismissal.workspace_id == tree.id,
            QualityIssueDismissal.issue_id == issue_id,
        )
    )
    if existing is not None:
        return None

    with UnitOfWork(db):
        db.add(
            QualityIssueDismissal(
                workspace_id=tree.id,
                issue_id=issue.id,
                issue_type=issue.issue_type,
                member_ids=json.dumps(issue.member_ids),
                dismissed_by_id=user.id,
            )
        )
    return None


@router.delete("/quality-report/issues/{issue_id}/dismiss", status_code=204)
def restore_quality_issue(
    issue_id: str,
    tree: Workspace = Depends(get_writable_workspace),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Undo a previous dismissal so the issue shows up again by default."""
    dismissal = db.scalar(
        select(QualityIssueDismissal).where(
            QualityIssueDismissal.workspace_id == tree.id,
            QualityIssueDismissal.issue_id == issue_id,
        )
    )
    if dismissal is not None:
        for member_id in json.loads(dismissal.member_ids):
            context.require_write_member(db, member_id, mode="delete")
        with UnitOfWork(db):
            db.delete(dismissal)
    return None
