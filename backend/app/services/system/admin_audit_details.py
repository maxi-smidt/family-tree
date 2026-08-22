"""Typed shapes for ``AdminAuditLog.details`` payloads.

These ``TypedDict``s type the JSON objects written by
``app.services.system.admin_audit.record_admin_audit`` and its call sites. They are
plain ``dict``s at runtime, so the stored JSON and CSV export remain unchanged.
"""

from typing import NotRequired, TypedDict

from app.schemas.setting import FeatureState


class ChangePair(TypedDict):
    """Generic before/after pair used by update diffs."""

    before: object
    after: object


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------


class UserCreateDetails(TypedDict, total=False):
    """``is_admin`` is always present; ``self_registration`` only for signups."""

    is_admin: bool
    self_registration: bool


class PasswordChangeMarker(TypedDict):
    """Marks that a password was changed, without exposing before/after values."""

    updated: bool


class UserUpdateDetails(TypedDict):
    changes: dict[str, ChangePair | PasswordChangeMarker]


class UserDeleteDetails(TypedDict):
    scheduled: bool
    self_service: NotRequired[bool]


class UserRestoreDetails(TypedDict):
    restored: bool


class UserDeletionCancelledDetails(TypedDict):
    deletion_cancelled: bool


class UserTotpResetDetails(TypedDict):
    two_factor_reset: bool


class UserPurgeDetails(TypedDict):
    purged_after_grace_period: bool


# ---------------------------------------------------------------------------
# Password management
# ---------------------------------------------------------------------------


class PasswordAdminResetDetails(TypedDict):
    admin_reset: bool


# ---------------------------------------------------------------------------
# Authentication / OAuth
# ---------------------------------------------------------------------------


class AuthLoginDetails(TypedDict, total=False):
    """Details for a successful login audit row.

    ``two_factor`` is present when 2FA was used; ``provider`` is present for
    OIDC logins.
    """

    two_factor: bool
    provider: str


class OAuthUserCreateDetails(TypedDict):
    provider: str
    is_admin: bool


# ---------------------------------------------------------------------------
# Two-factor authentication
# ---------------------------------------------------------------------------


class TwoFactorUpdateDetails(TypedDict):
    enabled: bool


# ---------------------------------------------------------------------------
# Trees
# ---------------------------------------------------------------------------


class TreeDeleteDetails(TypedDict, total=False):
    """Tree deletion carries no extra details."""


class PublicRoleSnapshot(TypedDict):
    public_role: str | None


class TreePublicAccessUpdateDetails(TypedDict):
    before: PublicRoleSnapshot
    after: PublicRoleSnapshot


class TreePublicAccessPasswordDetails(TypedDict):
    password_protected: bool


# ---------------------------------------------------------------------------
# Virtual views
# ---------------------------------------------------------------------------


class VirtualViewCreateDetails(TypedDict):
    source_ids: list[str]


class VirtualViewSnapshot(TypedDict):
    name: str
    source_ids: list[str]


class VirtualViewUpdateDetails(TypedDict):
    before: VirtualViewSnapshot
    after: VirtualViewSnapshot


class VirtualViewDeleteDetails(TypedDict, total=False):
    """Virtual-view deletion carries no extra details."""


# ---------------------------------------------------------------------------
# Backups
# ---------------------------------------------------------------------------


class BackupCreateSuccessDetails(TypedDict):
    trigger: str
    size_bytes: int


class BackupCreateFailedDetails(TypedDict):
    trigger: str
    status: str
    error: str


class BackupDeleteDetails(TypedDict):
    created_at: str
    status: str


# ---------------------------------------------------------------------------
# Feature flags
# ---------------------------------------------------------------------------


class FeatureFlagSnapshot(TypedDict):
    name: str
    state: FeatureState
    allowlist: list[str]


class FeatureFlagUpdateDetails(TypedDict):
    before: FeatureFlagSnapshot
    after: FeatureFlagSnapshot


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class SettingsChange(TypedDict):
    """One changed settings field."""

    before: bool | str | int | list[str]
    after: bool | str | int | list[str]


class SettingsChanges(TypedDict, total=False):
    """The full diff produced by ``settings_service.update_settings``.

    Only keys whose values changed are present.
    """

    allow_self_registration: SettingsChange
    instance_name: SettingsChange
    default_language: SettingsChange
    deletion_grace_period_days: SettingsChange
    backup_schedule_enabled: SettingsChange
    backup_interval_hours: SettingsChange
    backup_retention_count: SettingsChange
    max_image_upload_mb: SettingsChange
    max_image_dimension: SettingsChange
    max_document_upload_mb: SettingsChange
    default_tree_quota_mb: SettingsChange
    default_media_quota_mb: SettingsChange
    image_storage_mode: SettingsChange
    image_storage_allowed_modes: SettingsChange
    legal_acceptance_required: SettingsChange
    legal_version: SettingsChange
    legal_terms_body_de: SettingsChange
    legal_terms_body_en: SettingsChange
    legal_privacy_body_de: SettingsChange
    legal_privacy_body_en: SettingsChange
    legal_imprint_body_de: SettingsChange
    legal_imprint_body_en: SettingsChange


class AppSettingsUpdateDetails(TypedDict):
    changes: SettingsChanges


class LegalDocumentUpdateDetails(TypedDict):
    changes: SettingsChanges


# ---------------------------------------------------------------------------
# Union used by record_admin_audit
# ---------------------------------------------------------------------------


AdminAuditDetails = (
    UserCreateDetails
    | UserUpdateDetails
    | UserDeleteDetails
    | UserRestoreDetails
    | UserDeletionCancelledDetails
    | UserTotpResetDetails
    | UserPurgeDetails
    | PasswordAdminResetDetails
    | AuthLoginDetails
    | OAuthUserCreateDetails
    | TwoFactorUpdateDetails
    | TreeDeleteDetails
    | TreePublicAccessUpdateDetails
    | TreePublicAccessPasswordDetails
    | VirtualViewCreateDetails
    | VirtualViewUpdateDetails
    | VirtualViewDeleteDetails
    | BackupCreateSuccessDetails
    | BackupCreateFailedDetails
    | BackupDeleteDetails
    | FeatureFlagUpdateDetails
    | AppSettingsUpdateDetails
    | LegalDocumentUpdateDetails
)
"""All possible shapes stored in ``AdminAuditLog.details``."""
