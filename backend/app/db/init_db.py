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
from app.services.system.backups.backup_service import reconcile_interrupted_restore
from app.services.system.settings_service import ensure_defaults

logger = logging.getLogger("app.init")

# backend/app/db/init_db.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parents[2]


class UnsupportedDatabaseVersionError(RuntimeError):
    """The database is on a schema this release can no longer upgrade."""


# v1.x databases had to go through the v1 -> v2 conversion that shipped in
# v2.0.x (workspace consolidation, media relocation). That code is gone, so a
# database still on a v1 revision must be upgraded by a 2.0.x release first.
V1_REVISION_PREFIX = "v1_"

# Seeded into the instance-wide registry on startup. Admins manage the registry
# afterwards, so startup only tops up built-in defaults that are missing.
DEFAULT_RELATION_TYPES: list[str] = [
    "parent",
    "partner",
    "married",
    "divorced",
    "step-parent",
    "other",
]


def _current_heads() -> tuple[str, ...]:
    engine = create_engine(settings.sqlalchemy_database_uri)
    try:
        with engine.connect() as conn:
            return tuple(MigrationContext.configure(conn).get_current_heads())
    finally:
        engine.dispose()


def _check_upgradable(cfg: Config) -> None:
    """Refuse a database this release cannot upgrade safely.

    A fresh database (no alembic_version row) is fine: ``upgrade head`` builds
    the schema from scratch. A database on a v1 revision, or on a revision
    unknown to these scripts, is refused instead of being upgraded into a
    half-converted state.
    """
    current_heads = _current_heads()
    if not current_heads:
        return

    script = ScriptDirectory.from_config(cfg)
    known_ids = {rev.revision for rev in script.walk_revisions()}
    for head in current_heads:
        if head.startswith(V1_REVISION_PREFIX) or head not in known_ids:
            raise UnsupportedDatabaseVersionError(
                f"Database is at revision {head!r}, which this release cannot "
                "upgrade. Upgrade to v2.0.2 first so the v1 -> v2 conversion "
                "runs, then upgrade to this release."
            )


def run_migrations() -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.sqlalchemy_database_uri)

    _check_upgradable(cfg)
    command.upgrade(cfg, "head")


def init_db() -> None:
    settings.APP_DATA_PATH.mkdir(parents=True, exist_ok=True)

    run_migrations()

    # Reconcile any restore interrupted by a crash before the media root is
    # (re)created below — an empty directory here would block the rollback
    # rename that reconciliation may need to perform. See
    # app.services.system.backups.backup_service.reconcile_interrupted_restore.
    with SessionLocal() as db:
        reconcile_interrupted_restore(db)

    settings.media_root.mkdir(parents=True, exist_ok=True)

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
    # allowlisted-commit: bootstrap-only, before the app serves any request.
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
    # allowlisted-commit: bootstrap-only, before the app serves any request.
    db.commit()
    logger.info("Seeded initial admin user '%s'", settings.FIRST_ADMIN_USERNAME)
