from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import User
from app.schemas.user import (
    TabPreferences,
    TutorialPreferences,
    UserPreferences,
    WhatsNewState,
)
from app.services.settings_service import get_media_limits

router = APIRouter(prefix="/users/me/preferences", tags=["preferences"])


@router.get("/tabs", response_model=TabPreferences)
def get_tab_preferences(user: User = Depends(get_current_user)):
    return TabPreferences(**(user.tab_preferences or {}))


@router.put("/tabs", response_model=TabPreferences)
def put_tab_preferences(
    payload: TabPreferences,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user.tab_preferences = payload.model_dump()
    db.commit()
    return payload


@router.delete("/tabs", response_model=TabPreferences)
def reset_tab_preferences(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user.tab_preferences = None
    db.commit()
    return TabPreferences()


@router.get("/tutorial", response_model=TutorialPreferences)
def get_tutorial_preferences(user: User = Depends(get_current_user)):
    prefs = user.preferences or {}
    return TutorialPreferences(completed=bool(prefs.get("tutorial_completed", False)))


@router.put("/tutorial", response_model=TutorialPreferences)
def put_tutorial_preferences(
    payload: TutorialPreferences,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    prefs = dict(user.preferences or {})
    prefs["tutorial_completed"] = payload.completed
    user.preferences = prefs
    db.commit()
    return TutorialPreferences(completed=payload.completed)


@router.get("/settings", response_model=UserPreferences)
def get_user_preferences(user: User = Depends(get_current_user)):
    prefs = user.preferences or {}
    return UserPreferences(image_storage_mode=prefs.get("image_storage_mode"))


@router.put("/settings", response_model=UserPreferences)
def put_user_preferences(
    payload: UserPreferences,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.image_storage_mode is not None:
        limits = get_media_limits(db)
        if payload.image_storage_mode not in limits.image_storage_allowed_modes:
            raise HTTPException(
                status_code=400,
                detail=f"image_storage_mode '{payload.image_storage_mode}' is not "
                f"in the allowed modes {limits.image_storage_allowed_modes}.",
            )
    prefs = dict(user.preferences or {})
    if payload.image_storage_mode is None:
        prefs.pop("image_storage_mode", None)
    else:
        prefs["image_storage_mode"] = payload.image_storage_mode
    user.preferences = prefs
    db.commit()
    return UserPreferences(image_storage_mode=prefs.get("image_storage_mode"))


@router.get("/whats-new", response_model=WhatsNewState)
def get_whats_new_state(user: User = Depends(get_current_user)):
    prefs = user.preferences or {}
    return WhatsNewState(last_read_version=prefs.get("whats_new_last_read_version"))


@router.put("/whats-new", response_model=WhatsNewState)
def put_whats_new_state(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    prefs = dict(user.preferences or {})
    prefs["whats_new_last_read_version"] = settings.APP_VERSION
    user.preferences = prefs
    db.commit()
    return WhatsNewState(last_read_version=prefs.get("whats_new_last_read_version"))
