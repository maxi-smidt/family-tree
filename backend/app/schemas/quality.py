"""Schemas for the data-quality report."""

from pydantic import BaseModel


class QualityIssue(BaseModel):
    id: str
    issue_type: str
    severity: str  # "error" | "warning"
    member_ids: list[str]
    description: str
    dismissed: bool = False


class QualityReport(BaseModel):
    tree_id: str
    total_members: int
    issues: list[QualityIssue]
