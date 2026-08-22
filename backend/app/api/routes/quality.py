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
from app.models.content import Event, EventMemberLink
from app.models.family import Member, Relation
from app.models.quality import QualityIssueDismissal
from app.schemas.quality import QualityIssue, QualityReport
from app.services.members.bridge import drift_fields
from app.services.trees.quality_checks import issue_id_for, run_quality_checks

router = APIRouter(
    prefix="/trees/{tree_id}",
    tags=["quality"],
    dependencies=[Depends(require_feature("quality_report"))],
)


def _bridge_drift_issues(
    db: Session, user: User, members: list[Member]
) -> list[QualityIssue]:
    """Bridge persons whose two rows have drifted apart.

    Needs the db (counterpart rows live in other trees), so it runs here
    rather than in the pure ``run_quality_checks``. The comparison happens
    server-side only — field *names* are reported, never the other tree's
    values — and the whole check is dormant while tree_links is off.
    """
    linked = [m for m in members if m.linked_member_id]
    if not linked:
        return []
    from app.services.system import feature_service  # noqa: PLC0415

    if not feature_service.is_enabled(db, "tree_links", user):
        return []
    counterparts = {
        c.id: c
        for c in db.scalars(
            select(Member).where(
                Member.id.in_([m.linked_member_id for m in linked])
            )
        )
    }
    issues: list[QualityIssue] = []
    for m in linked:
        counterpart = counterparts.get(m.linked_member_id)
        if counterpart is None:
            continue
        fields = drift_fields(m, counterpart)
        if not fields:
            continue
        issues.append(
            QualityIssue(
                # Hash the drifted field set too, so a dismissed note comes
                # back when *new* fields start to differ.
                id=issue_id_for("bridge_person_drift", [m.id, *fields]),
                issue_type="bridge_person_drift",
                severity="warning",
                member_ids=[m.id],
                description=(
                    "Differs from the linked copy in another tree: "
                    f"{', '.join(f.replace('_', ' ') for f in fields)}."
                ),
            )
        )
    return issues


@router.get("/quality-report", response_model=QualityReport)
def get_quality_report(
    include_dismissed: bool = False,
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
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
    events = list(db.scalars(select(Event).where(Event.tree_id == tree.id)).all())
    event_links = list(
        db.scalars(
            select(EventMemberLink)
            .join(Event, Event.id == EventMemberLink.event_id)
            .where(Event.tree_id == tree.id)
        ).all()
    )
    raw_issues = run_quality_checks(members, relations, events, event_links)
    raw_issues += _bridge_drift_issues(db, user, members)

    dismissed_ids = set(
        db.scalars(
            select(QualityIssueDismissal.issue_id).where(
                QualityIssueDismissal.tree_id == tree.id
            )
        ).all()
    )

    issues = [
        i.model_copy(update={"dismissed": i.id in dismissed_ids}) for i in raw_issues
    ]
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
    events = list(db.scalars(select(Event).where(Event.tree_id == tree.id)).all())
    event_links = list(
        db.scalars(
            select(EventMemberLink)
            .join(Event, Event.id == EventMemberLink.event_id)
            .where(Event.tree_id == tree.id)
        ).all()
    )
    raw_issues = run_quality_checks(members, relations, events, event_links)
    issue = next((i for i in raw_issues if i.id == issue_id), None)
    if issue is None:
        raise HTTPException(status_code=404, detail="Quality issue not found")

    db.add(
        QualityIssueDismissal(
            tree_id=tree.id,
            issue_id=issue.id,
            issue_type=issue.issue_type,
            member_ids=json.dumps(issue.member_ids),
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
