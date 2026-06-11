from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

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
    is_admin: bool
    is_active: bool
    auth_provider: str
    created_at: str
    deletion_scheduled_for: str | None = None
    deletion_requested_by: str | None = None


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
