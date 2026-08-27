"""Real-PostgreSQL migration & recovery suite (#998).

Every other migration test in this repo runs against a throwaway in-memory
SQLite schema built by ``Base.metadata.create_all`` (see ``conftest.py``) —
cheap, but it never runs the real ``alembic upgrade head`` path, never
exercises a real Postgres advisory lock, and never seeds data through a
schema state that a real v1 instance actually had. This module does, against
a disposable Postgres database created (and dropped) per test.

Skipped automatically when no Postgres server is reachable — locally, start
one with ``docker compose -f docker-compose.dev.yml up -d db``; CI runs this
module in a dedicated job with a ``postgres`` service container (see
``.github/workflows/checks.yml``).

Scope: this suite proves the pieces that are otherwise completely untested —
the real Alembic chain from the oldest supported revision, the bridge ->
identity-link data migration running for real, cross-owner links staying
unmerged, an oversized/cyclic same-owner component collapsing correctly,
idempotent re-entry, real advisory-lock exclusivity across concurrent OS
processes, and checkpointed resume after an injected failure. Scenarios
already covered at the unit level against SQLite (bridge drift, photo drift,
virtual views, scoped grants, conflict review) and the ones owned by sibling
issues (#1022's production-scale rehearsal, #1023's provenance boundaries,
#1029's section grants) are deliberately not re-derived here.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import uuid
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path
from unittest.mock import patch

import psycopg2
import pytest
from alembic import command
from alembic.config import Config
from psycopg2 import sql
from sqlalchemy import MetaData, Table, create_engine, func, select, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, sessionmaker

import app.db.session as db_session_module
from app.core.config import settings
from app.db.base import utcnow_iso
from app.models import IdentityLink, Member, MigrationMapping, MigrationRun, Workspace
from app.models.migration import MigrationPhase, MigrationStatus
from app.services.migration.orchestrator import run_startup_migration
from app.services.system.backups import backup_service
from tests.conftest import add_member, make_tree, make_user

BACKEND_DIR = Path(__file__).resolve().parents[1]

_PG_HOST = os.environ.get("POSTGRES_HOST", "localhost")
_PG_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
_PG_USER = os.environ.get("POSTGRES_USER", "familytree")
_PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "familytree")
_PG_ADMIN_DB = os.environ.get("POSTGRES_DB", "familytree")
_TEST_SECRET_KEY = "test-only-secret-key-at-least-32-bytes-long-for-hs256"

# Right before v2_0_0_identity_links: the revision every fixture in this
# module seeds legacy bridge data against, so the *real* migration (not a
# hand-inserted IdentityLink row) is what converts it — see
# alembic/versions/v2_0_0_identity_links.py.
_PRE_IDENTITY_LINKS_REVISION = "v2_0_0_scoped_grants"


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
def pg_database() -> Iterator[str]:
    """Create a throwaway Postgres database for one test and drop it after."""
    name = f"ft_test_{uuid.uuid4().hex[:16]}"
    admin_conn = psycopg2.connect(
        host=_PG_HOST, port=_PG_PORT, user=_PG_USER, password=_PG_PASSWORD,
        dbname=_PG_ADMIN_DB,
    )
    admin_conn.autocommit = True
    try:
        with admin_conn.cursor() as cur:
            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
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


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _upgrade(dbname: str, revision: str = "head") -> None:
    # alembic/env.py deliberately overrides the Config's "sqlalchemy.url"
    # with ``settings.sqlalchemy_database_uri`` (its "source of truth for
    # both the URL and the schema") — the same thing a real deployment's
    # ``run_migrations()`` relies on — so pointing this at the throwaway
    # database means overriding the setting, not the Config object.
    previous = settings.DATABASE_URL
    settings.DATABASE_URL = _pg_url(dbname)
    try:
        command.upgrade(_alembic_config(), revision)
    finally:
        settings.DATABASE_URL = previous


@contextmanager
def _session(dbname: str) -> Iterator[Session]:
    engine = create_engine(_pg_url(dbname), future=True)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _reflect(engine: Engine, *names: str) -> dict[str, Table]:
    meta = MetaData()
    meta.reflect(bind=engine, only=list(names))
    return meta.tables


class V1Seed:
    """Minimal fixture builder for a database upgraded only as far as
    ``_PRE_IDENTITY_LINKS_REVISION``.

    The ORM models always reflect the *head* schema, so ``tests.conftest``'s
    ``make_user``/``make_tree``/``add_member`` can't insert here — e.g.
    ``Member.name_normalized`` is added by a later migration. This reflects
    the tables as they actually stand at that revision and supplies only the
    columns with no server-side default, matching a real not-yet-upgraded
    v1 row.
    """

    def __init__(self, conn: Connection) -> None:
        self._conn = conn
        tables = _reflect(conn.engine, "users", "workspaces", "members")
        self._users = tables["users"]
        self._workspaces = tables["workspaces"]
        self._members = tables["members"]

    def user(self, username: str) -> str:
        user_id = str(uuid.uuid4())
        self._conn.execute(
            self._users.insert().values(
                id=user_id,
                username=username,
                is_admin=False,
                is_active=True,
                auth_provider="local",
                created_at=utcnow_iso(),
            )
        )
        return user_id

    def workspace(self, owner_id: str, name: str) -> str:
        workspace_id = str(uuid.uuid4())
        self._conn.execute(
            self._workspaces.insert().values(
                id=workspace_id, name=name, owner_id=owner_id, created_at=utcnow_iso()
            )
        )
        return workspace_id

    def member(
        self,
        workspace_id: str,
        member_id: str,
        *,
        linked_workspace_id: str | None = None,
        linked_member_id: str | None = None,
    ) -> None:
        self._conn.execute(
            self._members.insert().values(
                id=member_id,
                workspace_id=workspace_id,
                is_collapsed=False,
                position_x=0.0,
                position_y=0.0,
                linked_workspace_id=linked_workspace_id,
                linked_member_id=linked_member_id,
            )
        )

    def bridge(
        self, member_id: str, linked_workspace_id: str, linked_member_id: str
    ) -> None:
        self._conn.execute(
            self._members.update()
            .where(self._members.c.id == member_id)
            .values(
                linked_workspace_id=linked_workspace_id,
                linked_member_id=linked_member_id,
            )
        )


def _worker_env(dbname: str, work_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        DATABASE_URL=_pg_url(dbname),
        SECRET_KEY=_TEST_SECRET_KEY,
        DATA_PATH=str(work_dir / "data"),
        APP_DATA_PATH=str(work_dir / "appdata"),
        ENVIRONMENT="test",
    )
    return env


_RUN_STARTUP_MIGRATION_SCRIPT = (
    "from app.db.session import SessionLocal\n"
    "from app.services.migration.orchestrator import run_startup_migration\n"
    "with SessionLocal() as db:\n"
    "    run_startup_migration(db)\n"
)


def _spawn_worker(env: dict[str, str]) -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-c", _RUN_STARTUP_MIGRATION_SCRIPT],
        cwd=BACKEND_DIR,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


# --- full Alembic chain + representative v1 fixture + idempotent re-entry --


def test_full_alembic_chain_converts_v1_fixture_and_is_idempotent(
    pg_database, tmp_path, monkeypatch
):
    dbname = pg_database
    # Every revision from the oldest supported baseline up to (not including)
    # the bridge -> identity-link conversion.
    _upgrade(dbname, _PRE_IDENTITY_LINKS_REVISION)

    pre_engine = create_engine(_pg_url(dbname), future=True)
    try:
        with pre_engine.begin() as conn:
            seed = V1Seed(conn)
            owner1 = seed.user("owner1")

            # An ordinary, unlinked single tree.
            solo = seed.workspace(owner1, "Solo")
            seed.member(solo, "solo-m1")
            seed.member(solo, "solo-m2")

            # A same-owner *cyclic* component of 12 workspaces — past the
            # legacy 10-depth/100-node linked-tree traversal caps — bridged
            # pairwise in a ring (ws0 <-> ws1 <-> ... <-> ws11 <-> ws0) via a
            # distinct, mutually reciprocal member pair per edge.
            ring_size = 12
            ring = [seed.workspace(owner1, f"Ring{i}") for i in range(ring_size)]
            for i, ws in enumerate(ring):
                seed.member(ws, f"ring{i}-a")
                seed.member(ws, f"ring{i}-b")
            for i in range(ring_size):
                j = (i + 1) % ring_size
                left, right = f"ring{i}-b", f"ring{j}-a"
                seed.bridge(left, ring[j], right)
                seed.bridge(right, ring[i], left)

            # Cross-owner reciprocal pair: a valid mutual bridge, but the two
            # workspaces have different owners, so they must never merge.
            owner2 = seed.user("owner2")
            owner3 = seed.user("owner3")
            cross_a = seed.workspace(owner2, "CrossA")
            cross_b = seed.workspace(owner3, "CrossB")
            seed.member(cross_a, "cross-a1")
            seed.member(cross_b, "cross-b1")
            seed.bridge("cross-a1", cross_b, "cross-b1")
            seed.bridge("cross-b1", cross_a, "cross-a1")

            # Dangling pointer: both FK targets are real rows (linked_member_id
            # and linked_workspace_id are themselves FK-enforced, so a truly
            # nonexistent target can't be inserted), but linked_workspace_id
            # doesn't match the counterpart's actual workspace — the drifted
            # shape ``_classify_legacy_bridge_links`` treats as dangling.
            owner4 = seed.user("owner4")
            dangling_ws = seed.workspace(owner4, "Dangling")
            seed.member(dangling_ws, "dangling-m1")
            seed.bridge("dangling-m1", dangling_ws, "solo-m1")

            # Asymmetric pointer: one-directional, must not merge.
            owner5 = seed.user("owner5")
            asym_a = seed.workspace(owner5, "AsymA")
            asym_b = seed.workspace(owner5, "AsymB")
            seed.member(asym_a, "asym-a1")
            seed.member(asym_b, "asym-b1")
            seed.bridge("asym-a1", asym_b, "asym-b1")
            # asym-b1 deliberately left unlinked, so the pointer is one-way.

            member_count_before = conn.execute(
                text("SELECT count(*) FROM members")
            ).scalar()
            workspace_count_before = conn.execute(
                text("SELECT count(*) FROM workspaces")
            ).scalar()
    finally:
        pre_engine.dispose()

    # Runs the real v2_0_0_identity_links migration (and the rest of the v2
    # chain) against the fixture just seeded — converting every live bridge
    # pointer above into a real identity_links row, not a hand-inserted one.
    _upgrade(dbname, "head")

    pg_engine = create_engine(_pg_url(dbname), future=True)
    monkeypatch.setattr(db_session_module, "engine", pg_engine)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path / "data")
    session_factory = sessionmaker(
        bind=pg_engine, autoflush=False, expire_on_commit=False
    )

    try:
        with session_factory() as db:
            run_startup_migration(db)

        with session_factory() as db:
            runs = list(db.scalars(select(MigrationRun)))
            assert len(runs) == 1
            run = runs[0]
            assert run.status == MigrationStatus.COMPLETE
            assert run.phase == MigrationPhase.VALIDATING

            # Every ring edge is a genuine bridge pair (same person recorded
            # once per linked tree) and collapses into a single member row;
            # nothing else in the fixture is a valid, same-owner pair, so
            # this is the only reduction expected.
            member_count_after_merges = member_count_before - ring_size
            assert db.scalar(select(func.count()).select_from(Member)) == (
                member_count_after_merges
            )

            # The solo tree survives untouched.
            assert db.get(Workspace, solo) is not None

            # The 12-workspace cyclic component collapsed into exactly one
            # surviving workspace, and every absorbed source maps to it.
            ring_ids = list(ring)
            surviving_ring = db.scalars(
                select(Workspace.id).where(Workspace.id.in_(ring_ids))
            ).all()
            assert len(surviving_ring) == 1
            mappings = db.scalars(
                select(MigrationMapping).where(
                    MigrationMapping.run_id == run.id,
                    MigrationMapping.source_workspace_id.in_(ring_ids),
                )
            ).all()
            assert {m.target_workspace_id for m in mappings} == set(surviving_ring)

            # Cross-owner link: both workspaces remain, the identity link
            # persists, but ownership keeps them from consolidating.
            assert db.get(Workspace, cross_a) is not None
            assert db.get(Workspace, cross_b) is not None
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(IdentityLink)
                    .where(
                        IdentityLink.member_a_id.in_(["cross-a1", "cross-b1"]),
                        IdentityLink.member_b_id.in_(["cross-a1", "cross-b1"]),
                    )
                )
                == 1
            )

            # Dangling and asymmetric pointers never merge their workspaces.
            assert db.get(Workspace, dangling_ws) is not None
            assert db.get(Workspace, asym_a) is not None
            assert db.get(Workspace, asym_b) is not None

            assert db.scalar(select(func.count()).select_from(Workspace)) == (
                workspace_count_before - (ring_size - 1)
            )

        # Idempotent second startup: re-running must not create a second run
        # or touch row counts again.
        with session_factory() as db:
            run_startup_migration(db)
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(MigrationRun)) == 1
            assert db.scalar(select(func.count()).select_from(Member)) == (
                member_count_after_merges
            )
    finally:
        pg_engine.dispose()


# --- real advisory-lock exclusivity across concurrent OS processes ---------


def test_concurrent_worker_processes_run_exactly_one_conversion(pg_database, tmp_path):
    dbname = pg_database
    _upgrade(dbname, "head")

    with _session(dbname) as db:
        owner = make_user(db, "owner")
        tree = make_tree(db, owner, name="Shared")
        add_member(db, tree, "m1")
        add_member(db, tree, "m2")

    # Every worker shares one DATA_PATH/APP_DATA_PATH, matching how sibling
    # processes of one deployment share a volume.
    env = _worker_env(dbname, tmp_path)
    workers = [_spawn_worker(env) for _ in range(4)]
    outputs = [(w, w.communicate()[0]) for w in workers]
    for worker, output in outputs:
        assert worker.returncode == 0, output

    with _session(dbname) as db:
        runs = list(db.scalars(select(MigrationRun)))
        assert len(runs) == 1
        assert runs[0].status == MigrationStatus.COMPLETE
        assert db.get(Workspace, tree.id) is not None
        assert db.scalar(select(func.count()).select_from(Member)) == 2


# --- checkpointed failure injection + deterministic resume -----------------


@pytest.mark.parametrize(
    "target",
    ["app.services.migration.orchestrator.run_conversion",
     "app.services.migration.orchestrator.run_media_relocation"],
)
def test_failure_at_a_checkpoint_resumes_without_redoing_earlier_phases(
    pg_database, tmp_path, monkeypatch, target
):
    dbname = pg_database
    _upgrade(dbname, "head")

    with _session(dbname) as db:
        owner = make_user(db, "owner")
        tree = make_tree(db, owner, name="Injected")
        add_member(db, tree, "m1")

    pg_engine = create_engine(_pg_url(dbname), future=True)
    monkeypatch.setattr(db_session_module, "engine", pg_engine)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path / "data")
    session_factory = sessionmaker(
        bind=pg_engine, autoflush=False, expire_on_commit=False
    )

    try:
        with patch(target, side_effect=RuntimeError("injected failure")):
            with session_factory() as db:
                with pytest.raises(RuntimeError, match="injected failure"):
                    run_startup_migration(db)

        with session_factory() as db:
            run = db.scalar(select(MigrationRun))
            assert run.status == MigrationStatus.RECOVERABLE
            assert run.backup_id is not None
            backup_id_after_failure = run.backup_id

        with patch(
            "app.services.system.backups.backup_service.create_backup"
        ) as create_backup_spy:
            with session_factory() as db:
                run_startup_migration(db)
            # The backup phase is already past its checkpoint; resuming must
            # not retake it.
            create_backup_spy.assert_not_called()

        with session_factory() as db:
            run = db.scalar(select(MigrationRun))
            assert run.status == MigrationStatus.COMPLETE
            assert run.phase == MigrationPhase.VALIDATING
            assert run.backup_id == backup_id_after_failure
            assert db.get(Workspace, tree.id) is not None
    finally:
        pg_engine.dispose()
