"""BackupRecord — tracks each backup attempt (manual or scheduled).

Also ``RestoreMarker``, a commit witness for restore atomicity: it is inserted
in the same transaction as the restored rows, so its presence in the database
is proof the transaction actually committed. See
``backup_service.restore_bundle`` and ``reconcile_interrupted_restore``.
"""

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid, utcnow_iso


class BackupRecord(Base):
    __tablename__ = "backup_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso, index=True)
    # "running" | "success" | "failed"
    status: Mapped[str] = mapped_column(String(20), default="running")
    # "manual" | "scheduled"
    trigger: Mapped[str] = mapped_column(String(20), default="manual")
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class RestoreMarker(Base):
    __tablename__ = "restore_markers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso, index=True)
