"""Database bootstrap: run migrations and seed the initial admin + settings."""

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import User
from app.services.settings_service import ensure_defaults

logger = logging.getLogger("app.init")

# backend/app/db/init_db.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parents[2]


def run_migrations() -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.sqlalchemy_database_uri)
    command.upgrade(cfg, "head")


def init_db() -> None:
    # Ensure media/appdata directories exist.
    settings.media_root.mkdir(parents=True, exist_ok=True)
    settings.APP_DATA_PATH.mkdir(parents=True, exist_ok=True)

    run_migrations()

    with SessionLocal() as db:
        ensure_defaults(db)
        _seed_admin(db)


def _seed_admin(db) -> None:
    user_count = db.scalar(select(func.count()).select_from(User))
    if user_count and user_count > 0:
        return
    if settings.FIRST_ADMIN_PASSWORD == "admin":
        logger.warning(
            "Seeding the admin account with the insecure default password "
            "'admin'. Set FIRST_ADMIN_PASSWORD to a strong value and change it "
            "after first login."
        )
    admin = User(
        username=settings.FIRST_ADMIN_USERNAME,
        email=settings.FIRST_ADMIN_EMAIL,
        full_name="Administrator",
        hashed_password=hash_password(settings.FIRST_ADMIN_PASSWORD),
        is_admin=True,
        is_active=True,
        auth_provider="local",
    )
    db.add(admin)
    db.commit()
    logger.info("Seeded initial admin user '%s'", settings.FIRST_ADMIN_USERNAME)
