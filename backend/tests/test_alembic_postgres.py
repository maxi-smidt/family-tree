"""Real-PostgreSQL Alembic suite.

The rest of the backend suite runs on SQLite schemas built by
``Base.metadata.create_all`` (see ``conftest.py``) and never runs the real
``alembic upgrade head`` path. This module does, against a disposable
Postgres database created (and dropped) per test, and covers the startup
guard that refuses databases this release can no longer upgrade.

Skipped automatically when no Postgres server is reachable — locally, start
one with ``docker compose -f docker-compose.dev.yml up -d db``; CI runs this
module in a dedicated job with a ``postgres`` service container (see
``.github/workflows/checks.yml``).
"""

from __future__ import annotations

import os
import socket
import uuid
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path

import psycopg2
import pytest
from alembic import command
from alembic.config import Config
from psycopg2 import sql
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import init_db
from app.models import User, Workspace

BACKEND_DIR = Path(__file__).resolve().parents[1]

_PG_HOST = os.environ.get("POSTGRES_HOST", "localhost")
_PG_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
_PG_USER = os.environ.get("POSTGRES_USER", "familytree")
_PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "familytree")
_PG_ADMIN_DB = os.environ.get("POSTGRES_DB", "familytree")

_LATEST_V1_REVISION = "v1_10_0_remove_feature_flags"
_LATEST_V2_0_REVISION = "v2_0_0_share_access_levels"
_DROPPED_TABLES = (
    "migration_runs",
    "migration_mappings",
    "migration_reports",
    "migration_conflicts",
    "migration_idempotency_keys",
    "virtual_views",
    "virtual_view_sources",
    "virtual_view_member_matches",
    "virtual_view_positions",
    "virtual_view_user_states",
)


def _postgres_reachable() -> bool:
    try:
        with closing(socket.create_connection((_PG_HOST, _PG_PORT), timeout=1)):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _postgres_reachable(),
    reason=(
        f"No reachable Postgres server at {_PG_HOST}:{_PG_PORT} — start one "
        "with `docker compose -f docker-compose.dev.yml up -d db` to run "
        "this suite locally; CI runs it in a dedicated Postgres job."
    ),
)


def _pg_url(dbname: str) -> str:
    return (
        f"postgresql+psycopg2://{_PG_USER}:{_PG_PASSWORD}"
        f"@{_PG_HOST}:{_PG_PORT}/{dbname}"
    )


@pytest.fixture()
def pg_database(monkeypatch) -> Iterator[str]:
    """Create a throwaway Postgres database for one test and drop it after.

    ``alembic/env.py`` and ``init_db`` both read
    ``settings.sqlalchemy_database_uri``, so the setting is pointed at the
    throwaway database for the duration of the test.
    """
    name = f"ft_test_{uuid.uuid4().hex[:16]}"
    admin_conn = psycopg2.connect(
        host=_PG_HOST,
        port=_PG_PORT,
        user=_PG_USER,
        password=_PG_PASSWORD,
        dbname=_PG_ADMIN_DB,
    )
    admin_conn.autocommit = True
    try:
        with admin_conn.cursor() as cur:
            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        monkeypatch.setattr(settings, "DATABASE_URL", _pg_url(name))
        yield name
    finally:
        with admin_conn.cursor() as cur:
            cur.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = %s AND pid <> pg_backend_pid()",
                (name,),
            )
            cur.execute(
                sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(name))
            )
        admin_conn.close()


def _upgrade(revision: str = "head") -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, revision)


@contextmanager
def _session(dbname: str) -> Iterator[Session]:
    engine = create_engine(_pg_url(dbname))
    try:
        with Session(engine) as session:
            yield session
    finally:
        engine.dispose()


def _seed_workspace(dbname: str) -> str:
    with _session(dbname) as db:
        user = User(
            username="owner",
            email="owner@example.com",
            hashed_password="x",
            auth_provider="local",
        )
        db.add(user)
        db.flush()
        db.add(Workspace(name="Family", owner_id=user.id))
        db.execute(
            text(
                "INSERT INTO notifications (id, user_id, type, created_at) VALUES "
                "('n-report', :u, 'migration_report_ready', 'now'), "
                "('n-friend', :u, 'friend_request_received', 'now')"
            ),
            {"u": user.id},
        )
        db.commit()
        return user.id


def _mark_conversion(dbname: str, status: str) -> None:
    with _session(dbname) as db:
        db.execute(
            text(
                "INSERT INTO migration_runs (id, source_version, target_version, "
                "status, phase, started_at, updated_at, version) VALUES "
                "('run-1', '1.10.2', '2.0.0', :s, 'validating', 'now', 'now', 1)"
            ),
            {"s": status},
        )
        db.commit()


def test_fresh_database_upgrades_to_head_without_migration_state(pg_database):
    init_db.run_migrations()

    with _session(pg_database) as db:
        tables = set(inspect(db.connection()).get_table_names())
        member_columns = {
            c["name"] for c in inspect(db.connection()).get_columns("members")
        }
    assert tables.isdisjoint(_DROPPED_TABLES)
    assert "workspaces" in tables
    assert "linked_member_id" not in member_columns


@pytest.mark.parametrize("status", ["complete", "finalized"])
def test_converted_v2_0_database_drops_migration_state(pg_database, status):
    _upgrade(_LATEST_V2_0_REVISION)
    _seed_workspace(pg_database)
    _mark_conversion(pg_database, status)

    init_db.run_migrations()

    with _session(pg_database) as db:
        tables = set(inspect(db.connection()).get_table_names())
        member_columns = {
            c["name"] for c in inspect(db.connection()).get_columns("members")
        }
        notification_types = set(
            db.scalars(text("SELECT type FROM notifications")).all()
        )
    assert tables.isdisjoint(_DROPPED_TABLES)
    assert member_columns.isdisjoint({"linked_member_id", "linked_workspace_id"})
    assert notification_types == {"friend_request_received"}


def test_unfinished_conversion_is_refused(pg_database):
    _upgrade(_LATEST_V2_0_REVISION)
    _seed_workspace(pg_database)
    _mark_conversion(pg_database, "recoverable")

    with pytest.raises(RuntimeError, match="v2.0.2"):
        init_db.run_migrations()

    with _session(pg_database) as db:
        assert inspect(db.connection()).has_table("migration_runs")


def test_v1_database_is_refused_before_upgrading(pg_database):
    _upgrade(_LATEST_V1_REVISION)

    with pytest.raises(init_db.UnsupportedDatabaseVersionError, match="v2.0.2"):
        init_db.run_migrations()

    with _session(pg_database) as db:
        version = db.scalar(text("SELECT version_num FROM alembic_version"))
    assert version == _LATEST_V1_REVISION
