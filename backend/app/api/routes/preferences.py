from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.user import (
    StoredUserPreferences,
    TabPreferences,
    TutorialPreferences,
    UserPreferences,
)
from app.services.system.settings_service import get_media_limits

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


def _stored_preferences(user: User) -> StoredUserPreferences:
    return StoredUserPreferences.model_validate(user.preferences or {})


@router.get("/tutorial", response_model=TutorialPreferences)
def get_tutorial_preferences(user: User = Depends(get_current_user)):
    return TutorialPreferences(completed=_stored_preferences(user).tutorial_completed)


@router.put("/tutorial", response_model=TutorialPreferences)
def put_tutorial_preferences(
    payload: TutorialPreferences,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    prefs = _stored_preferences(user)
    prefs.tutorial_completed = payload.completed
    user.preferences = prefs.model_dump()
    db.commit()
    return TutorialPreferences(completed=payload.completed)


@router.get("/settings", response_model=UserPreferences)
def get_user_preferences(user: User = Depends(get_current_user)):
    prefs = _stored_preferences(user)
    return UserPreferences(image_storage_mode=prefs.image_storage_mode)


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
    prefs = _stored_preferences(user)
    prefs.image_storage_mode = payload.image_storage_mode
    user.preferences = prefs.model_dump()
    db.commit()
    return UserPreferences(image_storage_mode=prefs.image_storage_mode)
