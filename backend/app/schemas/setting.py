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
    default_total_quota_mb: int = 0


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
    default_total_quota_mb: int | None = Field(default=None, ge=0)
