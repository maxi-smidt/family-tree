"""Database bootstrap: create tables and seed the initial admin + settings.

Schema is created from the ORM metadata (``create_all``) which keeps the schema
and models perfectly in sync. For richer, versioned migrations Alembic can be
layered on later without changing the models.
"""

import logging

from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models import User
from app.services.settings_service import ensure_defaults

logger = logging.getLogger("app.init")


def init_db() -> None:
    # Ensure media/appdata directories exist.
    settings.media_root.mkdir(parents=True, exist_ok=True)
    settings.APP_DATA_PATH.mkdir(parents=True, exist_ok=True)

    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        ensure_defaults(db)
        _seed_admin(db)


def _seed_admin(db) -> None:
    user_count = db.scalar(select(func.count()).select_from(User))
    if user_count and user_count > 0:
        return
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
