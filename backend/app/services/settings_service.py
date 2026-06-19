"""Helpers around the instance-wide ``app_settings`` key/value table.

Defaults are seeded from environment variables on first boot, after which the
database is the source of truth so admins can change them at runtime.
"""

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.media_config import (
    DEFAULT_IMAGE_STORAGE_MODE,
    DEFAULT_MAX_DOCUMENT_UPLOAD_MB,
    DEFAULT_MAX_IMAGE_DIMENSION,
    DEFAULT_MAX_IMAGE_UPLOAD_MB,
    DEFAULT_MEDIA_QUOTA_MB,
    DEFAULT_TREE_QUOTA_MB,
    IMAGE_STORAGE_MODES,
    MAX_MAX_DOCUMENT_UPLOAD_MB,
    MAX_MAX_IMAGE_DIMENSION,
    MAX_MAX_IMAGE_UPLOAD_MB,
    MEBIBYTE,
    MIN_MAX_DOCUMENT_UPLOAD_MB,
    MIN_MAX_IMAGE_DIMENSION,
    MIN_MAX_IMAGE_UPLOAD_MB,
    STORED_IMAGE_HEIGHT,
    STORED_IMAGE_WIDTH,
)
from app.models import AppSetting
from app.schemas.setting import MediaLimits, SettingsOut, SettingsUpdate

DEFAULTS: dict[str, str] = {
    "allow_self_registration": "true" if settings.ALLOW_SELF_REGISTRATION else "false",
    "instance_name": settings.APP_NAME,
    "default_language": "en",
    "deletion_grace_period_days": "7",
    "backup_schedule_enabled": "false",
    "backup_interval_hours": "24",
    "backup_retention_count": "7",
    "max_image_upload_mb": str(DEFAULT_MAX_IMAGE_UPLOAD_MB),
    "max_image_dimension": str(DEFAULT_MAX_IMAGE_DIMENSION),
    "max_document_upload_mb": str(DEFAULT_MAX_DOCUMENT_UPLOAD_MB),
    "default_tree_quota_mb": str(DEFAULT_TREE_QUOTA_MB),
    "default_media_quota_mb": str(DEFAULT_MEDIA_QUOTA_MB),
    "image_storage_mode": DEFAULT_IMAGE_STORAGE_MODE,
}

_TRUTHY = {"true", "1", "yes", "on"}

DEFAULT_DELETION_GRACE_PERIOD_DAYS = 7
DEFAULT_BACKUP_INTERVAL_HOURS = 24
DEFAULT_BACKUP_RETENTION_COUNT = 7


def get_setting(db: Session, key: str, default: str | None = None) -> str | None:
    row = db.get(AppSetting, key)
    return row.value if row is not None else default


def get_bool_setting(db: Session, key: str, default: bool = False) -> bool:
    value = get_setting(db, key)
    if value is None:
        return default
    return value.strip().lower() in _TRUTHY


def get_int_setting(db: Session, key: str, default: int = 0) -> int:
    value = get_setting(db, key)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def get_bounded_int_setting(
    db: Session,
    key: str,
    default: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    value = get_int_setting(db, key, default)
    return value if minimum <= value <= maximum else default


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


def get_media_limits(db: Session) -> MediaLimits:
    max_image_upload_mb = get_bounded_int_setting(
        db,
        "max_image_upload_mb",
        DEFAULT_MAX_IMAGE_UPLOAD_MB,
        minimum=MIN_MAX_IMAGE_UPLOAD_MB,
        maximum=MAX_MAX_IMAGE_UPLOAD_MB,
    )
    max_document_upload_mb = get_bounded_int_setting(
        db,
        "max_document_upload_mb",
        DEFAULT_MAX_DOCUMENT_UPLOAD_MB,
        minimum=MIN_MAX_DOCUMENT_UPLOAD_MB,
        maximum=MAX_MAX_DOCUMENT_UPLOAD_MB,
    )
    raw_mode = get_setting(db, "image_storage_mode", DEFAULT_IMAGE_STORAGE_MODE)
    image_storage_mode = (
        raw_mode if raw_mode in IMAGE_STORAGE_MODES else DEFAULT_IMAGE_STORAGE_MODE
    )
    return MediaLimits(
        max_image_bytes=max_image_upload_mb * MEBIBYTE,
        max_image_dimension=get_bounded_int_setting(
            db,
            "max_image_dimension",
            DEFAULT_MAX_IMAGE_DIMENSION,
            minimum=MIN_MAX_IMAGE_DIMENSION,
            maximum=MAX_MAX_IMAGE_DIMENSION,
        ),
        max_document_bytes=max_document_upload_mb * MEBIBYTE,
        stored_image_width=STORED_IMAGE_WIDTH,
        stored_image_height=STORED_IMAGE_HEIGHT,
        image_storage_mode=image_storage_mode,  # type: ignore[arg-type]
    )


def get_settings_out(db: Session) -> SettingsOut:
    media_limits = get_media_limits(db)
    return SettingsOut(
        allow_self_registration=get_bool_setting(db, "allow_self_registration", False),
        instance_name=get_setting(db, "instance_name", settings.APP_NAME),
        default_language=get_setting(db, "default_language", "en"),
        deletion_grace_period_days=get_int_setting(
            db, "deletion_grace_period_days", DEFAULT_DELETION_GRACE_PERIOD_DAYS
        ),
        backup_schedule_enabled=get_bool_setting(db, "backup_schedule_enabled", False),
        backup_interval_hours=get_int_setting(
            db, "backup_interval_hours", DEFAULT_BACKUP_INTERVAL_HOURS
        ),
        backup_retention_count=get_int_setting(
            db, "backup_retention_count", DEFAULT_BACKUP_RETENTION_COUNT
        ),
        max_image_upload_mb=media_limits.max_image_bytes // MEBIBYTE,
        max_image_dimension=media_limits.max_image_dimension,
        max_document_upload_mb=media_limits.max_document_bytes // MEBIBYTE,
        default_tree_quota_mb=get_int_setting(
            db, "default_tree_quota_mb", DEFAULT_TREE_QUOTA_MB
        ),
        default_media_quota_mb=get_int_setting(
            db, "default_media_quota_mb", DEFAULT_MEDIA_QUOTA_MB
        ),
        image_storage_mode=media_limits.image_storage_mode,
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
    if payload.deletion_grace_period_days is not None:
        set_setting(
            db,
            "deletion_grace_period_days",
            str(payload.deletion_grace_period_days),
        )
    if payload.backup_schedule_enabled is not None:
        set_setting(
            db,
            "backup_schedule_enabled",
            "true" if payload.backup_schedule_enabled else "false",
        )
    if payload.backup_interval_hours is not None:
        set_setting(db, "backup_interval_hours", str(payload.backup_interval_hours))
    if payload.backup_retention_count is not None:
        set_setting(db, "backup_retention_count", str(payload.backup_retention_count))
    if payload.max_image_upload_mb is not None:
        set_setting(db, "max_image_upload_mb", str(payload.max_image_upload_mb))
    if payload.max_image_dimension is not None:
        set_setting(db, "max_image_dimension", str(payload.max_image_dimension))
    if payload.max_document_upload_mb is not None:
        set_setting(
            db,
            "max_document_upload_mb",
            str(payload.max_document_upload_mb),
        )
    if payload.default_tree_quota_mb is not None:
        set_setting(db, "default_tree_quota_mb", str(payload.default_tree_quota_mb))
    if payload.default_media_quota_mb is not None:
        set_setting(db, "default_media_quota_mb", str(payload.default_media_quota_mb))
    if payload.image_storage_mode is not None:
        set_setting(db, "image_storage_mode", payload.image_storage_mode)
    db.commit()
    return get_settings_out(db)
