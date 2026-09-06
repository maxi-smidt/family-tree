"""Data-quality report endpoint."""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_workspace,
    get_writable_workspace,
)
from app.db.session import get_db
from app.models import User, Workspace
from app.models.content import Event, EventMemberLink
from app.models.family import Member, Relation
from app.models.quality import QualityIssueDismissal
from app.schemas.quality import QualityReport
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.quality_checks import run_quality_checks

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["quality"],
)


@router.get("/quality-report", response_model=QualityReport)
def get_quality_report(
    include_dismissed: bool = False,
    tree: Workspace = Depends(get_readable_workspace),
    db: Session = Depends(get_db),
):
    """Return a non-destructive data-quality report for the tree.

    Accessible to anyone with at least read access. Dismissed issues are
    excluded by default; pass ``include_dismissed=true`` to get the full
    list with each issue's ``dismissed`` flag set.
    """
    members = list(db.scalars(select(Member).where(Member.workspace_id == tree.id)).all())
    relations = list(
        db.scalars(select(Relation).where(Relation.workspace_id == tree.id)).all()
    )
    events = list(db.scalars(select(Event).where(Event.workspace_id == tree.id)).all())
    event_links = list(
        db.scalars(
            select(EventMemberLink)
            .join(Event, Event.id == EventMemberLink.event_id)
            .where(Event.workspace_id == tree.id)
        ).all()
    )
    raw_issues = run_quality_checks(members, relations, events, event_links)

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
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Dismiss a quality issue so it no longer shows up by default.

    The issue must currently exist (i.e. be produced by the live checks) to
    be dismissable. Dismissals are tree-scoped and shared by every editor.
    """
    existing = db.scalar(
        select(QualityIssueDismissal).where(
            QualityIssueDismissal.workspace_id == tree.id,
            QualityIssueDismissal.issue_id == issue_id,
        )
    )
    if existing is not None:
        return None

    members = list(db.scalars(select(Member).where(Member.workspace_id == tree.id)).all())
    relations = list(
        db.scalars(select(Relation).where(Relation.workspace_id == tree.id)).all()
    )
    events = list(db.scalars(select(Event).where(Event.workspace_id == tree.id)).all())
    event_links = list(
        db.scalars(
            select(EventMemberLink)
            .join(Event, Event.id == EventMemberLink.event_id)
            .where(Event.workspace_id == tree.id)
        ).all()
    )
    raw_issues = run_quality_checks(members, relations, events, event_links)
    issue = next((i for i in raw_issues if i.id == issue_id), None)
    if issue is None:
        raise HTTPException(status_code=404, detail="Quality issue not found")

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
        with UnitOfWork(db):
            db.delete(dismissal)
    return None
