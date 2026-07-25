from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.schemas.setting import ImageStorageMode

MIN_PASSWORD_LENGTH = 8


def _validate_password(value: str) -> str:
    if len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"
        )
    return value


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    email: str | None = None
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    is_admin: bool
    is_active: bool
    auth_provider: str
    created_at: str
    deletion_scheduled_for: str | None = None
    deletion_requested_by: str | None = None
    tree_quota_bytes: int | None = None
    media_quota_bytes: int | None = None


class CurrentUserOut(UserOut):
    """The calling user plus their resolved feature-flag set.

    Only for "who am I" responses (login/me); admin user lists stay ``UserOut``
    since another user's feature set would be misleading there.
    """

    features: list[str] = []
    totp_enabled: bool = False
    # Effective storage mode (user preference or admin default) and the
    # admin-allowed set so the frontend can filter available options.
    image_storage_mode: ImageStorageMode = "compressed"
    image_storage_allowed_modes: list[ImageStorageMode] = ["compressed"]
    # Legal Terms/Privacy/Impressum acceptance gate state, resolved server-side
    # so the frontend can show the blocking gate immediately on login/`/me`.
    legal_acceptance_required: bool = True
    legal_accepted: bool = False
    # Only present for the signed-in user; profile media cannot be read by
    # other accounts.
    profile_image_url: str | None = None


class UserProfileUpdate(BaseModel):
    """Self-service profile fields. Empty form values clear the stored name."""

    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)

    @field_validator("first_name", "last_name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class UserPreferences(BaseModel):
    image_storage_mode: ImageStorageMode | None = None


class TutorialPreferences(BaseModel):
    completed: bool = False


class WhatsNewState(BaseModel):
    last_read_version: str | None = None


class StoredUserPreferences(BaseModel):
    """The validated shape of the ``User.preferences`` JSON blob.

    Multiplexes three unrelated concerns (tutorial progress, image storage
    choice, changelog read state) into one column; this model is the single
    source of truth for what's actually persisted there, read and written
    through ``model_validate``/``model_dump`` instead of raw ``dict``
    access. ``tab_preferences`` is a separate, genuinely free-form per-user
    layout column and is intentionally not covered here.
    """

    tutorial_completed: bool = False
    image_storage_mode: ImageStorageMode | None = None
    whats_new_last_read_version: str | None = None


class UserCreate(BaseModel):
    username: str
    password: str
    email: EmailStr | None = None
    full_name: str | None = None
    is_admin: bool = False

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = None
    password: str | None = None
    is_admin: bool | None = None
    is_active: bool | None = None
    tree_quota_bytes: int | None = Field(default=None, ge=0)
    media_quota_bytes: int | None = Field(default=None, ge=0)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str | None) -> str | None:
        if v is not None:
            return _validate_password(v)
        return v


class UserPasswordReset(BaseModel):
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class AccountSelfDelete(BaseModel):
    """Confirmation payload for self-serve account deletion.

    Exactly one field must be present: ``password`` for local accounts,
    ``confirm_username`` for OIDC accounts (which have no stored password).
    """

    password: str | None = None
    confirm_username: str | None = None


class AccountRestore(BaseModel):
    """Credential payload for restoring a self-initiated pending deletion."""

    username: str
    password: str


class TabPreferences(BaseModel):
    order: list[str] = Field(default_factory=list)
    hidden: list[str] = Field(default_factory=list)

    @field_validator("order", "hidden")
    @classmethod
    def dedupe_and_validate(cls, v: list[str]) -> list[str]:
        deduped = list(dict.fromkeys(v))
        if any(len(item) > 64 for item in deduped):
            raise ValueError("Tab id too long")
        return deduped
