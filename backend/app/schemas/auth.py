from pydantic import BaseModel

from app.schemas.user import CurrentUserOut


class LoginRequest(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: CurrentUserOut


class LoginResponse(BaseModel):
    """Unified response for POST /auth/login.

    When TOTP is not enabled the full token is returned directly.
    When TOTP is required, ``totp_required`` is True and ``totp_session_token``
    holds a short-lived (5-minute) JWT that must be passed to POST /auth/totp.
    """

    access_token: str | None = None
    token_type: str = "bearer"
    user: CurrentUserOut | None = None
    totp_required: bool = False
    totp_session_token: str | None = None


class TotpVerifyRequest(BaseModel):
    session_token: str
    code: str


class TotpSetupResponse(BaseModel):
    secret: str
    otpauth_url: str
    recovery_codes: list[str]


class TotpEnableRequest(BaseModel):
    code: str


class TotpEnableResponse(BaseModel):
    totp_enabled: bool


class TotpDisableRequest(BaseModel):
    password: str
    code: str


class AuthConfig(BaseModel):
    """Public auth configuration the SPA needs before a user logs in."""

    authentik_enabled: bool
    allow_self_registration: bool
    authentik_login_url: str | None = None
