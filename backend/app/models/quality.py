"""Persisted dismissals for data-quality report issues.

Quality issues themselves are computed on the fly (see
``app.services.workspaces.quality_checks``) and never stored; only the fact that an
issue was dismissed is persisted here, keyed by a deterministic issue id
derived from the issue's type and member ids. Dismissals are tree-scoped
(shared by every editor of the tree, not per-user).
"""

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class QualityIssueDismissal(Base):
    __tablename__ = "quality_issue_dismissals"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "issue_id", name="uq_quality_dismissal_workspace_issue"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    # Deterministic hash of issue_type + sorted member_ids (see quality_checks.py).
    issue_id: Mapped[str] = mapped_column(String(64), index=True)
    issue_type: Mapped[str] = mapped_column(String(50))
    # JSON-encoded list of member ids, kept for display purposes only.
    member_ids: Mapped[str] = mapped_column(Text)

    dismissed_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    dismissed_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
