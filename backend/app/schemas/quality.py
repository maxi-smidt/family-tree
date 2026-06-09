"""Schemas for the data-quality report."""

from pydantic import BaseModel


class QualityIssue(BaseModel):
    issue_type: str
    severity: str  # "error" | "warning"
    member_ids: list[str]
    description: str


class QualityReport(BaseModel):
    tree_id: str
    total_members: int
    issues: list[QualityIssue]
