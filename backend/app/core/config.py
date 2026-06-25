"""Application configuration.

All settings are read from environment variables (or an optional ``.env`` file),
which makes the service straightforward to configure from ``docker-compose``.
"""

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Load the repo-root .env regardless of the process working directory — the
# same file docker-compose reads, so there is exactly one place to configure
# the stack. Real environment variables (e.g. those injected by docker-compose)
# still take precedence over the file, so containers don't need a .env at all.
_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore"
    )

    # --- General -----------------------------------------------------------
    APP_NAME: str = "Family Tree"
    APP_VERSION: str = "dev"
    APP_REVISION: str = "dev"
    APP_BUILD_DATE: str = ""
    ENVIRONMENT: str = "production"
    API_PREFIX: str = "/api"

    # Secret used to sign JWTs and the OAuth session cookie. MUST be overridden
    # in production via the environment.
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    JWT_ALGORITHM: str = "HS256"

    # How often the background sweep purges users whose deletion grace period
    # has elapsed (also runs once at startup).
    DELETION_SWEEP_INTERVAL_SECONDS: int = 60 * 60  # 1 hour

    # --- Database ----------------------------------------------------------
    # Either provide a full DATABASE_URL or the individual POSTGRES_* parts.
    # The default host is "localhost" so a host-run dev backend connects to the
    # db published by `docker compose up -d db` with no extra config; in
    # production docker-compose sets POSTGRES_HOST=db (the service name).
    DATABASE_URL: str | None = None

    # --- Redis (optional) --------------------------------------------------
    # External Redis instance — not bundled in the compose stack.
    # Leave unset to disable Redis entirely (graceful degradation).
    # Supported schemes: redis://, rediss:// (TLS), redis://:password@host/db
    REDIS_URL: str | None = None
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "familytree"
    POSTGRES_PASSWORD: str = "familytree"
    POSTGRES_DB: str = "familytree"

    # Connection pool sizing. SQLAlchemy's QueuePool defaults (5 + 10 overflow)
    # are too small given the ~40-thread sync request threadpool. Keep
    # (DB_POOL_SIZE + DB_MAX_OVERFLOW) * WORKERS below Postgres max_connections
    # (default 100). DB_POOL_RECYCLE drops connections older than N seconds to
    # avoid stale ones behind an idle-timeout proxy/Postgres.
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_RECYCLE: int = 1800  # seconds (30 min)

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
    # Comma separated list of allowed origins for the browser SPA. NoDecode
    # stops pydantic-settings from JSON-parsing the env value so the validator
    # below can split a plain comma-separated string.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost",
        "http://localhost:1420",
    ]
    # Absolute URL the SPA is served from; used to redirect back after OAuth.
    FRONTEND_URL: str = "http://localhost"

    # --- Authentication ----------------------------------------------------
    ALLOW_SELF_REGISTRATION: bool = False

    # Brute-force protection for /auth/login: after LOGIN_MAX_ATTEMPTS failed
    # attempts (per client IP + username) within the window, further attempts
    # are rejected with 429 until the window rolls off.
    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 900  # 15 minutes

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

    # --- Error monitoring (optional) -------------------------------------------
    # Point at a Sentry-compatible DSN (self-hosted GlitchTip or sentry.io) to
    # enable server-side error reporting.  Unset or empty = total no-op.
    SENTRY_DSN: str | None = None
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

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
    def sentry_enabled(self) -> bool:
        return bool(self.SENTRY_DSN)

    @property
    def redis_enabled(self) -> bool:
        return bool(self.REDIS_URL)

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
