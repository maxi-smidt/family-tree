from pydantic import BaseModel

from app.schemas.user import CurrentUserOut


class LoginRequest(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: CurrentUserOut


class AuthConfig(BaseModel):
    """Public auth configuration the SPA needs before a user logs in."""

    authentik_enabled: bool
    allow_self_registration: bool
    authentik_login_url: str | None = None
