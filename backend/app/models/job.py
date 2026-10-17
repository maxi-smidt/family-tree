"""BackgroundJob — tracks in-flight background operations and their progress."""

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class BackgroundJob(Base):
    __tablename__ = "background_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    # "import" | "import_gedcom" | "merge" | "extract_subtree"
    type: Mapped[str] = mapped_column(String(40))
    # "pending" | "running" | "done" | "failed"
    status: Mapped[str] = mapped_column(String(20), default="pending")
    progress_pct: Mapped[int] = mapped_column(Integer, default=0)
    result_workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso, index=True)
    updated_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
