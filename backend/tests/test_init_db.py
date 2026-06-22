"""Startup admin seeding: respects existing users and Authentik linkage."""

from sqlalchemy import func, select

from app.core.config import settings
from app.db.init_db import _seed_admin
from app.models import User
from tests.conftest import make_user


def _user_count(db) -> int:
    return db.scalar(select(func.count()).select_from(User))


def test_seeds_local_admin_when_no_users(db):
    _seed_admin(db)

    admin = db.scalar(select(User).where(User.is_admin.is_(True)))
    assert admin is not None
    assert admin.username == settings.FIRST_ADMIN_USERNAME
    assert admin.auth_provider == "local"


def test_skips_seed_when_users_exist(db):
    make_user(db)

    _seed_admin(db)

    # No extra admin account is created on top of the existing user.
    assert _user_count(db) == 1


def test_skips_local_admin_when_authentik_enabled(db, monkeypatch):
    monkeypatch.setattr(settings, "AUTHENTIK_CLIENT_ID", "client-id")
    monkeypatch.setattr(settings, "AUTHENTIK_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(
        settings, "AUTHENTIK_DISCOVERY_URL", "https://authentik.example.com/.well-known"
    )
    assert settings.authentik_enabled

    _seed_admin(db)

    # Admins are provisioned via the Authentik group instead of FIRST_ADMIN_*.
    assert _user_count(db) == 0
