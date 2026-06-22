"""Database bootstrap: run migrations and seed the initial admin + settings."""

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, select

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import RelationType, User
from app.services.settings_service import ensure_defaults

logger = logging.getLogger("app.init")

# backend/app/db/init_db.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parents[2]

# Revision ID of the squashed baseline migration.  Any database stamped with a
# pre-squash revision (unknown to the current chain) is stamped here first so
# that the normal upgrade can apply post-squash migrations on top.
BASELINE_REVISION = "v1_0_0_baseline"

# Seeded into the instance-wide registry on startup. Admins manage the registry
# afterwards, so startup only tops up built-in defaults that are missing.
DEFAULT_RELATION_TYPES: list[str] = [
    "parent",
    "sibling",
    "partner",
    "married",
    "divorced",
    "step-parent",
    "step-sibling",
    "half-sibling",
    "other",
]


def _stored_revision_is_unknown(cfg: Config) -> bool:
    """Return True if alembic_version points to a revision not in the scripts.

    A fresh database (no alembic_version row) returns False — normal upgrade
    will build the schema from scratch.  A database at any known revision also
    returns False.  Only a database stamped with a revision that no longer
    exists in the migration chain (e.g. a pre-squash revision) returns True.
    """
    script = ScriptDirectory.from_config(cfg)
    known_ids = {rev.revision for rev in script.walk_revisions()}

    engine = create_engine(settings.sqlalchemy_database_uri)
    try:
        with engine.connect() as conn:
            current_heads = MigrationContext.configure(conn).get_current_heads()
    finally:
        engine.dispose()

    if not current_heads:
        return False  # fresh DB; upgrade head will create the schema normally

    return any(head not in known_ids for head in current_heads)


def run_migrations() -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.sqlalchemy_database_uri)

    if _stored_revision_is_unknown(cfg):
        logger.warning(
            "Database is stamped with a revision unknown to the current "
            "migration scripts (pre-squash database detected). Stamping "
            "baseline %s and continuing with pending migrations.",
            BASELINE_REVISION,
        )
        # purge=True clears alembic_version and writes the baseline directly.
        # A plain stamp would fail here because Alembic tries to resolve the
        # current (now-removed) revision to compute the path, raising
        # "Can't locate revision ...".
        command.stamp(cfg, BASELINE_REVISION, purge=True)

    command.upgrade(cfg, "head")


def init_db() -> None:
    # Ensure media/appdata directories exist.
    settings.media_root.mkdir(parents=True, exist_ok=True)
    settings.APP_DATA_PATH.mkdir(parents=True, exist_ok=True)

    run_migrations()

    with SessionLocal() as db:
        ensure_defaults(db)
        _seed_relation_types(db)
        _seed_admin(db)


def _seed_relation_types(db) -> None:
    existing = set(db.scalars(select(RelationType.id)).all())
    missing = [rt for rt in DEFAULT_RELATION_TYPES if rt not in existing]
    if not missing:
        return
    for rt in missing:
        db.add(RelationType(id=rt))
    db.commit()
    logger.info("Seeded %d missing default relation types", len(missing))


def _seed_admin(db) -> None:
    user_count = db.scalar(select(func.count()).select_from(User))
    if user_count and user_count > 0:
        return
    if settings.authentik_enabled:
        # With Authentik linked, admins are provisioned through the configured
        # admin group on first OIDC login. Skip seeding a local admin from the
        # FIRST_ADMIN_* env vars so we don't leave behind an unused (and often
        # default-password) local account.
        logger.info(
            "Authentik is configured; skipping local admin seed. Grant admin "
            "via the '%s' Authentik group.",
            settings.AUTHENTIK_ADMIN_GROUP,
        )
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
