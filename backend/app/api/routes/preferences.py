from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.user import TabPreferences

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
