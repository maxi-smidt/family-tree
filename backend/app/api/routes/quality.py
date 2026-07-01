"""Data-quality report endpoint."""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_readable_tree,
    get_writable_tree,
    require_feature,
)
from app.db.session import get_db
from app.models import Tree, User
from app.models.family import Member, Relation
from app.models.quality import QualityIssueDismissal
from app.schemas.quality import QualityIssue, QualityReport
from app.services.quality_checks import run_quality_checks

router = APIRouter(
    prefix="/trees/{tree_id}",
    tags=["quality"],
    dependencies=[Depends(require_feature("quality_report"))],
)


@router.get("/quality-report", response_model=QualityReport)
def get_quality_report(
    include_dismissed: bool = False,
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    """Return a non-destructive data-quality report for the tree.

    Accessible to anyone with at least read access. Dismissed issues are
    excluded by default; pass ``include_dismissed=true`` to get the full
    list with each issue's ``dismissed`` flag set.
    """
    members = list(db.scalars(select(Member).where(Member.tree_id == tree.id)).all())
    relations = list(
        db.scalars(select(Relation).where(Relation.tree_id == tree.id)).all()
    )
    raw_issues = run_quality_checks(members, relations)

    dismissed_ids = set(
        db.scalars(
            select(QualityIssueDismissal.issue_id).where(
                QualityIssueDismissal.tree_id == tree.id
            )
        ).all()
    )

    issues = [QualityIssue(**i, dismissed=i["id"] in dismissed_ids) for i in raw_issues]
    if not include_dismissed:
        issues = [i for i in issues if not i.dismissed]

    return QualityReport(
        tree_id=tree.id,
        total_members=len(members),
        issues=issues,
    )


@router.post("/quality-report/issues/{issue_id}/dismiss", status_code=204)
def dismiss_quality_issue(
    issue_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Dismiss a quality issue so it no longer shows up by default.

    The issue must currently exist (i.e. be produced by the live checks) to
    be dismissable. Dismissals are tree-scoped and shared by every editor.
    """
    existing = db.scalar(
        select(QualityIssueDismissal).where(
            QualityIssueDismissal.tree_id == tree.id,
            QualityIssueDismissal.issue_id == issue_id,
        )
    )
    if existing is not None:
        return None

    members = list(db.scalars(select(Member).where(Member.tree_id == tree.id)).all())
    relations = list(
        db.scalars(select(Relation).where(Relation.tree_id == tree.id)).all()
    )
    raw_issues = run_quality_checks(members, relations)
    issue = next((i for i in raw_issues if i["id"] == issue_id), None)
    if issue is None:
        raise HTTPException(status_code=404, detail="Quality issue not found")

    db.add(
        QualityIssueDismissal(
            tree_id=tree.id,
            issue_id=issue["id"],
            issue_type=issue["issue_type"],
            member_ids=json.dumps(issue["member_ids"]),
            dismissed_by_id=user.id,
        )
    )
    db.commit()
    return None


@router.delete("/quality-report/issues/{issue_id}/dismiss", status_code=204)
def restore_quality_issue(
    issue_id: str,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    """Undo a previous dismissal so the issue shows up again by default."""
    dismissal = db.scalar(
        select(QualityIssueDismissal).where(
            QualityIssueDismissal.tree_id == tree.id,
            QualityIssueDismissal.issue_id == issue_id,
        )
    )
    if dismissal is not None:
        db.delete(dismissal)
        db.commit()
    return None
