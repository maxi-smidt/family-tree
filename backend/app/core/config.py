"""Application configuration.

All settings are read from environment variables (or an optional ``.env`` file),
which makes the service straightforward to configure from ``docker-compose``.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- General -----------------------------------------------------------
    APP_NAME: str = "Family Tree"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = "production"
    API_PREFIX: str = "/api"

    # Secret used to sign JWTs and the OAuth session cookie. MUST be overridden
    # in production via the environment.
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    JWT_ALGORITHM: str = "HS256"

    # --- Database ----------------------------------------------------------
    # Either provide a full DATABASE_URL or the individual POSTGRES_* parts.
    DATABASE_URL: str | None = None
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "familytree"
    POSTGRES_PASSWORD: str = "familytree"
    POSTGRES_DB: str = "familytree"

    # --- Filesystem paths --------------------------------------------------
    # DATA_PATH      -> the "real" user data (member photos, gallery media).
    # APP_DATA_PATH  -> application working data (exports, temp files, ...).
    #
    # Defaults are dev-friendly relative paths so running the backend directly
    # (e.g. `uv run uvicorn ...`) works out of the box. In Docker these are set
    # to absolute /data and /appdata via the compose environment.
    DATA_PATH: Path = Path("./.data")
    APP_DATA_PATH: Path = Path("./.appdata")

    # --- CORS / frontend ---------------------------------------------------
    # Comma separated list of allowed origins for the browser SPA.
    CORS_ORIGINS: list[str] = ["http://localhost", "http://localhost:1420"]
    # Absolute URL the SPA is served from; used to redirect back after OAuth.
    FRONTEND_URL: str = "http://localhost"

    # --- Authentication ----------------------------------------------------
    ALLOW_SELF_REGISTRATION: bool = False

    # Seed admin account, created on first start if no users exist.
    FIRST_ADMIN_USERNAME: str = "admin"
    FIRST_ADMIN_PASSWORD: str = "admin"
    FIRST_ADMIN_EMAIL: str = "admin@example.com"

    # --- Authentik (OIDC) --------------------------------------------------
    AUTHENTIK_CLIENT_ID: str | None = None
    AUTHENTIK_CLIENT_SECRET: str | None = None
    # The OpenID Connect discovery document, e.g.
    # https://authentik.example.com/application/o/family-tree/.well-known/openid-configuration
    AUTHENTIK_DISCOVERY_URL: str | None = None
    AUTHENTIK_SCOPES: str = "openid email profile"
    # New users signing in through Authentik are auto-provisioned.
    AUTHENTIK_AUTO_CREATE_USERS: bool = True
    # Username/group that should be granted admin when provisioned via Authentik.
    AUTHENTIK_ADMIN_GROUP: str = "family-tree-admins"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

    @property
    def sqlalchemy_database_uri(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return (
            f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def authentik_enabled(self) -> bool:
        return bool(
            self.AUTHENTIK_CLIENT_ID
            and self.AUTHENTIK_CLIENT_SECRET
            and self.AUTHENTIK_DISCOVERY_URL
        )

    @property
    def media_root(self) -> Path:
        return self.DATA_PATH / "media"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
