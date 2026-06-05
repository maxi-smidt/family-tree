"""Helpers around the instance-wide ``app_settings`` key/value table.

Defaults are seeded from environment variables on first boot, after which the
database is the source of truth so admins can change them at runtime.
"""

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AppSetting
from app.schemas.setting import SettingsOut, SettingsUpdate

DEFAULTS: dict[str, str] = {
    "allow_self_registration": "true" if settings.ALLOW_SELF_REGISTRATION else "false",
    "instance_name": settings.APP_NAME,
    "default_language": "en",
}

_TRUTHY = {"true", "1", "yes", "on"}


def get_setting(db: Session, key: str, default: str | None = None) -> str | None:
    row = db.get(AppSetting, key)
    return row.value if row is not None else default


def get_bool_setting(db: Session, key: str, default: bool = False) -> bool:
    value = get_setting(db, key)
    if value is None:
        return default
    return value.strip().lower() in _TRUTHY


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value


def ensure_defaults(db: Session) -> None:
    changed = False
    for key, value in DEFAULTS.items():
        if db.get(AppSetting, key) is None:
            db.add(AppSetting(key=key, value=value))
            changed = True
    if changed:
        db.commit()


def get_settings_out(db: Session) -> SettingsOut:
    return SettingsOut(
        allow_self_registration=get_bool_setting(db, "allow_self_registration", False),
        instance_name=get_setting(db, "instance_name", settings.APP_NAME),
        default_language=get_setting(db, "default_language", "en"),
    )


def update_settings(db: Session, payload: SettingsUpdate) -> SettingsOut:
    if payload.allow_self_registration is not None:
        set_setting(
            db,
            "allow_self_registration",
            "true" if payload.allow_self_registration else "false",
        )
    if payload.instance_name is not None:
        set_setting(db, "instance_name", payload.instance_name)
    if payload.default_language is not None:
        set_setting(db, "default_language", payload.default_language)
    db.commit()
    return get_settings_out(db)
