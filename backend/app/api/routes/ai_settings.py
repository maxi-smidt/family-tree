"""A person's own AI provider for transcribing document files (#1123)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User, UserAiSettings
from app.schemas.ai import AiProviderInfo, AiSettingsOut, AiSettingsSave
from app.services.ai.ai_settings import (
    get_ai_settings,
    is_configured,
    key_is_readable,
    save_ai_settings,
)
from app.services.ai.providers import PROVIDERS
from app.services.unit_of_work import UnitOfWork

router = APIRouter(prefix="/users/me/ai-settings", tags=["ai"])


def _out(row: UserAiSettings | None) -> AiSettingsOut:
    providers = [
        AiProviderInfo(
            id=cls.id,
            label=cls.label,
            default_model=cls.default_model,
            needs_api_key=cls.needs_api_key,
            custom_base_url=cls.custom_base_url,
            supports_pdf=cls.supports_pdf,
        )
        for cls in PROVIDERS.values()
    ]
    if row is None:
        return AiSettingsOut(providers=providers)
    has_key = row.api_key_sealed is not None
    return AiSettingsOut(
        configured=is_configured(row),
        provider=row.provider,
        model=row.model,
        base_url=row.base_url,
        has_api_key=has_key,
        api_key_hint=row.api_key_hint,
        api_key_unreadable=has_key and not key_is_readable(row),
        providers=providers,
    )


@router.get("", response_model=AiSettingsOut)
def get_settings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(get_ai_settings(db, user))


@router.put("", response_model=AiSettingsOut)
def put_settings(
    payload: AiSettingsSave,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with UnitOfWork(db):
        row = save_ai_settings(
            db,
            user,
            provider=payload.provider,
            model=payload.model,
            base_url=payload.base_url,
            api_key=payload.api_key,
        )
    db.refresh(row)
    return _out(row)


@router.delete("", response_model=AiSettingsOut)
def delete_settings(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Turn AI off for this person and forget their key."""
    row = get_ai_settings(db, user)
    if row is not None:
        with UnitOfWork(db):
            db.delete(row)
    return _out(None)
