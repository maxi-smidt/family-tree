"""Data-quality report endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_tree, require_feature
from app.db.session import get_db
from app.models import Tree
from app.models.family import Member, Relation
from app.schemas.quality import QualityIssue, QualityReport
from app.services.quality_checks import run_quality_checks

router = APIRouter(
    prefix="/trees/{tree_id}",
    tags=["quality"],
    dependencies=[Depends(require_feature("quality_report"))],
)


@router.get("/quality-report", response_model=QualityReport)
def get_quality_report(
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    """Return a non-destructive data-quality report for the tree.

    Accessible to anyone with at least read access.
    """
    members = list(
        db.scalars(select(Member).where(Member.tree_id == tree.id)).all()
    )
    relations = list(
        db.scalars(select(Relation).where(Relation.tree_id == tree.id)).all()
    )
    raw_issues = run_quality_checks(members, relations)
    return QualityReport(
        tree_id=tree.id,
        total_members=len(members),
        issues=[QualityIssue(**i) for i in raw_issues],
    )
