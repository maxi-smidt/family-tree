"""A person's AI provider settings, with their API key sealed at rest."""

from __future__ import annotations

from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.core.exceptions import AccessDeniedError, InvalidInputError
from app.core.secret_box import SecretUnreadable, seal, unseal
from app.db.base import utcnow_iso
from app.models import User, UserAiSettings
from app.services.ai.providers import (
    PROVIDERS,
    AiProviderError,
    TranscriptionProvider,
    create_provider,
)

_KEY_PURPOSE = "ai-api-key"

DEFAULT_PROMPT = (
    "Transcribe all text in this document exactly as written, in its original "
    "language. Do not translate, summarize, modernize or correct anything.\n"
    "Return the transcription as meaningful Markdown: keep the document's "
    "structure with headings, paragraphs, lists and tables where the original "
    "has them.\n"
    "Mark words you cannot read as [?]. Never guess or invent names, dates or "
    "places.\n"
    "If the document has several pages, put <!-- page N --> on its own line "
    "before each page.\n"
    "Return only the Markdown, without code fences and without comments about "
    "the document."
)


def get_ai_settings(db: Session, user: User | str) -> UserAiSettings | None:
    user_id = user if isinstance(user, str) else user.id
    return db.get(UserAiSettings, user_id)


def read_api_key(row: UserAiSettings) -> str | None:
    """The stored key in plain text; raises when it can no longer be opened
    (the server's SECRET_KEY changed since it was saved)."""
    if row.api_key_sealed is None:
        return None
    try:
        return unseal(row.api_key_sealed, purpose=_KEY_PURPOSE, context=row.user_id)
    except SecretUnreadable as exc:
        raise AiProviderError("unreadable_key") from exc


def key_is_readable(row: UserAiSettings) -> bool:
    try:
        read_api_key(row)
    except AiProviderError:
        return False
    return True


def is_configured(row: UserAiSettings | None) -> bool:
    """Whether *row* is complete enough to run a transcription."""
    if row is None or row.provider not in PROVIDERS:
        return False
    if row.api_key_sealed is None:
        return not PROVIDERS[row.provider].needs_api_key
    return key_is_readable(row)


def effective_prompt(row: UserAiSettings) -> str:
    return row.prompt if row.prompt and row.prompt.strip() else DEFAULT_PROMPT


def provider_for(row: UserAiSettings) -> TranscriptionProvider:
    return create_provider(
        row.provider, model=row.model, api_key=read_api_key(row), base_url=row.base_url
    )


def save_ai_settings(
    db: Session,
    user: User,
    *,
    provider: str,
    model: str,
    base_url: str | None,
    api_key: str | None,
    prompt: str | None,
) -> UserAiSettings:
    """Create or replace *user*'s settings (the caller commits).

    ``api_key`` ``None`` keeps the stored key (dropped when the provider
    changes, since a key belongs to one provider); ``""`` removes it.
    """
    cls = PROVIDERS.get(provider)
    if cls is None:
        raise InvalidInputError("unknown_provider")
    if cls.custom_base_url:
        if not user.is_admin:
            raise AccessDeniedError("custom_endpoint_admin_only")
        parsed = urlparse(base_url or "")
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise InvalidInputError("invalid_base_url")
    else:
        base_url = None

    now = utcnow_iso()
    row = get_ai_settings(db, user)
    if row is None:
        row = UserAiSettings(user_id=user.id, created_at=now)
        db.add(row)
    elif row.provider != provider and api_key is None:
        row.api_key_sealed = None
        row.api_key_hint = None

    if api_key is not None:
        key = api_key.strip()
        row.api_key_sealed = (
            seal(key, purpose=_KEY_PURPOSE, context=user.id) if key else None
        )
        row.api_key_hint = key[-4:] if len(key) >= 12 else None
    if cls.needs_api_key and row.api_key_sealed is None:
        raise InvalidInputError("api_key_required")

    row.provider = provider
    row.model = model.strip() or cls.default_model
    row.base_url = base_url
    row.prompt = (
        prompt if prompt and prompt.strip() and prompt != DEFAULT_PROMPT else None
    )
    row.updated_at = now
    return row
