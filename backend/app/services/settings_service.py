"""Helpers around the instance-wide ``app_settings`` key/value table.

Defaults are seeded from environment variables on first boot, after which the
database is the source of truth so admins can change them at runtime.
"""

import hashlib

from sqlalchemy import select
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
from app.models import AppSetting, LegalAcceptance, LegalDocumentVersion, User
from app.schemas.setting import MediaLimits, SettingsOut, SettingsUpdate
from app.services.admin_audit import record_admin_audit
from app.services.legal_defaults import (
    DEFAULT_LEGAL_BODIES,
    LEGAL_DEFAULT_LOCALE,
    LEGAL_LOCALES,
)

# AppSetting keys for each (document_type, locale) body, e.g.
# "legal_terms_body_de". A version is one release across all locales/docs, so
# legal_version itself stays a single, non-localized key.
LEGAL_DOCUMENT_TYPES: tuple[str, ...] = ("terms", "privacy", "imprint")

# Legal documents are versioned automatically: the seeded placeholder text is
# version "0", and the first admin edit (where the operator fills in the real
# data) bumps it to "1". Every subsequent body edit bumps it again, which forces
# re-acceptance. Admins never set the version by hand.
DEFAULT_LEGAL_VERSION = "0"


def legal_body_setting_key(document_type: str, locale: str) -> str:
    return f"legal_{document_type}_body_{locale}"


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
    "image_storage_allowed_modes": ",".join(IMAGE_STORAGE_MODES),
    "announcement_title": "",
    "announcement_body": "",
    "announcement_version": "",
    "legal_acceptance_required": "true",
    "legal_version": DEFAULT_LEGAL_VERSION,
    **{
        legal_body_setting_key(document_type, locale): body
        for document_type, bodies in DEFAULT_LEGAL_BODIES.items()
        for locale, body in bodies.items()
    },
}

_TRUTHY = {"true", "1", "yes", "on"}

DEFAULT_DELETION_GRACE_PERIOD_DAYS = 7
DEFAULT_BACKUP_INTERVAL_HOURS = 24
DEFAULT_BACKUP_RETENTION_COUNT = 7


def effective_storage_mode(
    admin_default: str, allowed_modes: list[str], user_mode: str | None
) -> str:
    """Return the mode for a user: their preference if allowed, else the admin default."""
    if user_mode and user_mode in allowed_modes:
        return user_mode
    return admin_default


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
    # Snapshot whatever legal text now exists (freshly seeded or already
    # there from a prior boot) so v1 is always immutably recorded.
    snapshot_current_legal_versions(db)


def content_hash(body: str) -> str:
    """Stable sha256 hex digest of a legal document body."""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def get_legal_body(db: Session, document_type: str, locale: str) -> str:
    """The current admin-editable body for ``(document_type, locale)``.

    Falls back to ``LEGAL_DEFAULT_LOCALE`` (German) when the requested
    locale's body is empty — German is the authoritative legal locale for
    this deployment.
    """
    body = get_setting(db, legal_body_setting_key(document_type, locale), "") or ""
    if body or locale == LEGAL_DEFAULT_LOCALE:
        return body
    return (
        get_setting(db, legal_body_setting_key(document_type, LEGAL_DEFAULT_LOCALE), "")
        or ""
    )


def snapshot_current_legal_versions(db: Session) -> list[LegalDocumentVersion]:
    """Immutably snapshot the current terms/privacy/imprint bodies.

    Iterates every ``(document_type, locale)`` pair. For each, if no
    ``LegalDocumentVersion`` row already exists with the current
    ``(document_type, locale, content_hash)``, insert one tagged with the
    current ``legal_version``. Idempotent: re-running with unchanged text
    creates nothing. Editing a locale's body without bumping ``legal_version``
    still creates a new row (the hash changed), so no edit is ever lost; an
    unchanged body re-saved under a bumped version is de-duplicated by hash
    (per locale).
    """
    current_version = (
        get_setting(db, "legal_version", DEFAULT_LEGAL_VERSION) or DEFAULT_LEGAL_VERSION
    )
    created: list[LegalDocumentVersion] = []
    for document_type in LEGAL_DOCUMENT_TYPES:
        for locale in LEGAL_LOCALES:
            body = (
                get_setting(db, legal_body_setting_key(document_type, locale), "") or ""
            )
            if not body:
                continue
            digest = content_hash(body)
            exists = db.scalar(
                select(LegalDocumentVersion).where(
                    LegalDocumentVersion.document_type == document_type,
                    LegalDocumentVersion.locale == locale,
                    LegalDocumentVersion.content_hash == digest,
                )
            )
            if exists is not None:
                continue
            row = LegalDocumentVersion(
                document_type=document_type,
                locale=locale,
                version=current_version,
                body=body,
                content_hash=digest,
            )
            db.add(row)
            created.append(row)
    if created:
        db.commit()
    return created


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
    all_modes_default = ",".join(IMAGE_STORAGE_MODES)
    raw_allowed = get_setting(db, "image_storage_allowed_modes", all_modes_default)
    image_storage_allowed_modes = [
        m for m in (raw_allowed or "").split(",") if m.strip() in IMAGE_STORAGE_MODES
    ] or list(IMAGE_STORAGE_MODES)
    if image_storage_mode not in image_storage_allowed_modes:
        image_storage_mode = image_storage_allowed_modes[0]
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
        image_storage_allowed_modes=image_storage_allowed_modes,  # type: ignore[arg-type]
    )


def user_has_accepted_legal(db: Session, user: User) -> bool:
    """Whether ``user`` has accepted the currently published legal version.

    Used both to expose ``legal_accepted`` on ``/me`` (informational) and to
    hard-enforce the gate in ``get_writable_tree`` (blocking). When
    ``legal_acceptance_required`` is off, every user is considered accepted.

    The ``legal_acceptances`` table is the single source of truth: acceptance
    holds only while a row exists for the current version, so removing that row
    (e.g. an admin clearing the audit log) correctly re-triggers the gate.
    """
    if not get_bool_setting(db, "legal_acceptance_required", True):
        return True
    current_version = (
        get_setting(db, "legal_version", DEFAULT_LEGAL_VERSION) or DEFAULT_LEGAL_VERSION
    )
    return (
        db.scalar(
            select(LegalAcceptance.id).where(
                LegalAcceptance.user_id == user.id,
                LegalAcceptance.version == current_version,
            )
        )
        is not None
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
        image_storage_allowed_modes=media_limits.image_storage_allowed_modes,
        announcement_title=get_setting(db, "announcement_title", "") or "",
        announcement_body=get_setting(db, "announcement_body", "") or "",
        announcement_version=get_setting(db, "announcement_version", "") or "",
        legal_acceptance_required=get_bool_setting(
            db, "legal_acceptance_required", True
        ),
        legal_version=get_setting(db, "legal_version", "1") or "1",
        legal_terms_body_de=get_setting(db, legal_body_setting_key("terms", "de"), "")
        or "",
        legal_terms_body_en=get_setting(db, legal_body_setting_key("terms", "en"), "")
        or "",
        legal_privacy_body_de=get_setting(
            db, legal_body_setting_key("privacy", "de"), ""
        )
        or "",
        legal_privacy_body_en=get_setting(
            db, legal_body_setting_key("privacy", "en"), ""
        )
        or "",
        legal_imprint_body_de=get_setting(
            db, legal_body_setting_key("imprint", "de"), ""
        )
        or "",
        legal_imprint_body_en=get_setting(
            db, legal_body_setting_key("imprint", "en"), ""
        )
        or "",
    )


def update_settings(
    db: Session, payload: SettingsUpdate, *, actor: User | None = None
) -> SettingsOut:
    before = get_settings_out(db).model_dump()
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
    if payload.image_storage_allowed_modes is not None:
        allowed = [
            m for m in payload.image_storage_allowed_modes if m in IMAGE_STORAGE_MODES
        ]
        if not allowed:
            allowed = list(IMAGE_STORAGE_MODES)
        set_setting(db, "image_storage_allowed_modes", ",".join(allowed))
        raw_default = get_setting(db, "image_storage_mode", DEFAULT_IMAGE_STORAGE_MODE)
        if raw_default not in allowed:
            set_setting(db, "image_storage_mode", allowed[0])
    if payload.image_storage_mode is not None:
        current_allowed_raw = get_setting(
            db, "image_storage_allowed_modes", ",".join(IMAGE_STORAGE_MODES)
        )
        current_allowed = [
            m for m in (current_allowed_raw or "").split(",") if m in IMAGE_STORAGE_MODES
        ] or list(IMAGE_STORAGE_MODES)
        mode = (
            payload.image_storage_mode
            if payload.image_storage_mode in current_allowed
            else current_allowed[0]
        )
        set_setting(db, "image_storage_mode", mode)
    if payload.announcement_title is not None:
        set_setting(db, "announcement_title", payload.announcement_title.strip())
    if payload.announcement_body is not None:
        set_setting(db, "announcement_body", payload.announcement_body.strip())
    if payload.announcement_version is not None:
        set_setting(db, "announcement_version", payload.announcement_version.strip())
    if payload.legal_acceptance_required is not None:
        set_setting(
            db,
            "legal_acceptance_required",
            "true" if payload.legal_acceptance_required else "false",
        )
    # Legal document bodies are auto-versioned: any change to a body bumps
    # legal_version under the hood (which forces re-acceptance); an unchanged
    # save leaves the version — and therefore existing acceptances — untouched.
    legal_body_changed = False
    for document_type in LEGAL_DOCUMENT_TYPES:
        for locale in LEGAL_LOCALES:
            value = getattr(payload, f"legal_{document_type}_body_{locale}")
            if value is None:
                continue
            key = legal_body_setting_key(document_type, locale)
            new_value = value.strip()
            if new_value != (get_setting(db, key, "") or ""):
                legal_body_changed = True
            set_setting(db, key, new_value)
    if legal_body_changed:
        current = (
            get_setting(db, "legal_version", DEFAULT_LEGAL_VERSION)
            or DEFAULT_LEGAL_VERSION
        )
        try:
            next_version = str(int(current) + 1)
        except ValueError:
            next_version = "1"
        set_setting(db, "legal_version", next_version)
    db.flush()
    result = get_settings_out(db)
    changed = {
        key: {"before": before[key], "after": value}
        for key, value in result.model_dump().items()
        if before[key] != value
    }
    if changed:
        record_admin_audit(
            db,
            actor=actor,
            action="update",
            subject_type="legal_document" if legal_body_changed else "app_settings",
            subject_id="legal" if legal_body_changed else None,
            subject_label=(
                "Legal documents" if legal_body_changed else "Instance settings"
            ),
            details={"changes": changed},
        )
    db.commit()
    if legal_body_changed:
        # Immutably snapshot the now-live text under the freshly bumped version.
        snapshot_current_legal_versions(db)
    return result
