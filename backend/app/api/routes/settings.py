"""Admin-managed instance settings."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models import User
from app.schemas.setting import SettingsOut, SettingsUpdate
from app.services import settings_service

router = APIRouter(
    prefix="/settings", tags=["settings"], dependencies=[Depends(require_admin)]
)


@router.get("", response_model=SettingsOut)
def read_settings(db: Session = Depends(get_db)):
    return settings_service.get_settings_out(db)


@router.patch("", response_model=SettingsOut)
def update_settings(
    payload: SettingsUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return settings_service.update_settings(db, payload, actor=user)
