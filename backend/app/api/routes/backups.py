"""Admin API for instance-wide encrypted backups."""

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import BackupRecord, User
from app.services.system.admin_audit import record_admin_audit
from app.services.system.backups import backup_service

router = APIRouter(
    prefix="/admin/backups",
    tags=["backups"],
    dependencies=[Depends(require_admin)],
)


class BackupOut(BaseModel):
    id: str
    created_at: str
    status: str
    trigger: str
    filename: str | None
    size_bytes: int | None
    error: str | None


def _to_out(record: BackupRecord) -> BackupOut:
    return BackupOut(
        id=record.id,
        created_at=record.created_at,
        status=record.status,
        trigger=record.trigger,
        filename=record.filename,
        size_bytes=record.size_bytes,
        error=record.error,
    )


@router.get("", response_model=list[BackupOut])
def list_backups(db: Session = Depends(get_db)):
    return [_to_out(r) for r in backup_service.list_backups(db)]


@router.post("", response_model=BackupOut, status_code=201)
def trigger_backup(
    user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    record = backup_service.create_backup(db, trigger="manual", actor=user)
    return _to_out(record)


@router.get("/{backup_id}/download")
def download_backup(backup_id: str, db: Session = Depends(get_db)):
    record = db.scalars(
        select(BackupRecord).where(BackupRecord.id == backup_id)
    ).first()
    if record is None or record.filename is None:
        raise HTTPException(status_code=404, detail="Backup not found")

    filepath = backup_service.BACKUP_DIR / record.filename
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found on disk")

    return Response(
        content=filepath.read_bytes(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{record.filename}"'
        },
    )


@router.delete("/{backup_id}", status_code=204)
def delete_backup(
    backup_id: str,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    record = db.scalars(
        select(BackupRecord).where(BackupRecord.id == backup_id)
    ).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Backup not found")
    record_admin_audit(
        db, actor=user, action="delete", subject_type="backup",
        subject_id=record.id, subject_label=record.filename,
        details={"created_at": record.created_at, "status": record.status},
    )
    backup_service.delete_backup(db, record)
