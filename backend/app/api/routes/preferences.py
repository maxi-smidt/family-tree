from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.user import TabPreferences, UserPreferences
from app.services.settings_service import allowed_storage_modes, get_media_limits

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
        if payload.image_storage_mode not in allowed_storage_modes(
            limits.image_storage_mode
        ):
            raise HTTPException(
                status_code=400,
                detail=f"image_storage_mode '{payload.image_storage_mode}' is not "
                f"permitted by the instance setting '{limits.image_storage_mode}'.",
            )
    prefs = dict(user.preferences or {})
    if payload.image_storage_mode is None:
        prefs.pop("image_storage_mode", None)
    else:
        prefs["image_storage_mode"] = payload.image_storage_mode
    user.preferences = prefs
    db.commit()
    return UserPreferences(image_storage_mode=prefs.get("image_storage_mode"))
