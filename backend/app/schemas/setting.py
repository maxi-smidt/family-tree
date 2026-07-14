from typing import Literal

from pydantic import BaseModel, Field

from app.core.media_config import (
    MAX_MAX_DOCUMENT_UPLOAD_MB,
    MAX_MAX_IMAGE_DIMENSION,
    MAX_MAX_IMAGE_UPLOAD_MB,
    MIN_MAX_DOCUMENT_UPLOAD_MB,
    MIN_MAX_IMAGE_DIMENSION,
    MIN_MAX_IMAGE_UPLOAD_MB,
)

FeatureState = Literal["on", "off", "beta"]
ImageStorageMode = Literal["compressed", "original", "both"]


class FeatureFlagOut(BaseModel):
    name: str
    state: FeatureState
    allowlist: list[str]


class FeatureFlagUpdate(BaseModel):
    state: FeatureState | None = None
    allowlist: list[str] | None = None


class MediaLimits(BaseModel):
    max_image_bytes: int
    max_image_dimension: int
    max_document_bytes: int
    stored_image_width: int
    stored_image_height: int
    image_storage_mode: ImageStorageMode = "compressed"
    image_storage_allowed_modes: list[ImageStorageMode] = Field(
        default_factory=lambda: ["compressed", "original", "both"]
    )


class SettingsOut(BaseModel):
    allow_self_registration: bool
    instance_name: str
    default_language: str
    deletion_grace_period_days: int
    backup_schedule_enabled: bool = False
    backup_interval_hours: int = 24
    backup_retention_count: int = 7
    max_image_upload_mb: int
    max_image_dimension: int
    max_document_upload_mb: int
    default_tree_quota_mb: int = 0
    default_media_quota_mb: int = 0
    image_storage_mode: ImageStorageMode = "compressed"
    image_storage_allowed_modes: list[ImageStorageMode] = Field(
        default_factory=lambda: ["compressed", "original", "both"]
    )
    legal_acceptance_required: bool = True
    legal_version: str = "1"
    legal_terms_body_de: str = ""
    legal_terms_body_en: str = ""
    legal_privacy_body_de: str = ""
    legal_privacy_body_en: str = ""
    legal_imprint_body_de: str = ""
    legal_imprint_body_en: str = ""


class SettingsUpdate(BaseModel):
    allow_self_registration: bool | None = None
    instance_name: str | None = None
    default_language: str | None = None
    deletion_grace_period_days: int | None = Field(default=None, ge=0)
    backup_schedule_enabled: bool | None = None
    backup_interval_hours: int | None = Field(default=None, ge=1)
    backup_retention_count: int | None = Field(default=None, ge=1)
    max_image_upload_mb: int | None = Field(
        default=None,
        ge=MIN_MAX_IMAGE_UPLOAD_MB,
        le=MAX_MAX_IMAGE_UPLOAD_MB,
    )
    max_image_dimension: int | None = Field(
        default=None,
        ge=MIN_MAX_IMAGE_DIMENSION,
        le=MAX_MAX_IMAGE_DIMENSION,
    )
    max_document_upload_mb: int | None = Field(
        default=None,
        ge=MIN_MAX_DOCUMENT_UPLOAD_MB,
        le=MAX_MAX_DOCUMENT_UPLOAD_MB,
    )
    default_tree_quota_mb: int | None = Field(default=None, ge=0)
    default_media_quota_mb: int | None = Field(default=None, ge=0)
    image_storage_mode: ImageStorageMode | None = None
    image_storage_allowed_modes: list[ImageStorageMode] | None = None
    legal_acceptance_required: bool | None = None
    # legal_version is intentionally not settable here — it is bumped
    # automatically whenever a legal document body changes (see update_settings).
    legal_terms_body_de: str | None = Field(default=None, max_length=50000)
    legal_terms_body_en: str | None = Field(default=None, max_length=50000)
    legal_privacy_body_de: str | None = Field(default=None, max_length=50000)
    legal_privacy_body_en: str | None = Field(default=None, max_length=50000)
    legal_imprint_body_de: str | None = Field(default=None, max_length=50000)
    legal_imprint_body_en: str | None = Field(default=None, max_length=50000)
