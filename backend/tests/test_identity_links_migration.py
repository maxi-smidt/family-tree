"""Data-migration test for v2_0_0_identity_links (#985).

Exercises the migration's ``migrate_legacy_bridges_to_identity_links`` helper
directly against a hermetic SQLite schema, mirroring
``tests/test_documents_migration.py``.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "v2_0_0_identity_links.py"
    )
    spec = importlib.util.spec_from_file_location(
        "v2_0_0_identity_links_under_test", path
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


migration = _load_migration_module()


def _build_schema() -> sa.MetaData:
    meta = sa.MetaData()
    sa.Table(
        "workspaces",
        meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36)),
        sa.Column("name", sa.String(255)),
    )
    sa.Table(
        "members",
        meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36)),
        sa.Column("linked_workspace_id", sa.String(36), nullable=True),
        sa.Column("linked_member_id", sa.String(36), nullable=True),
        sa.UniqueConstraint("workspace_id", "id"),
    )
    sa.Table(
        "notifications",
        meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36)),
        sa.Column("type", sa.String(50)),
        sa.Column("payload", sa.Text, nullable=True),
        sa.Column("created_at", sa.String(40)),
        sa.Column("read_at", sa.String(40), nullable=True),
    )
    sa.Table(
        "identity_links",
        meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("member_a_id", sa.String(36)),
        sa.Column("member_b_id", sa.String(36)),
        sa.Column("workspace_a_id", sa.String(36)),
        sa.Column("workspace_b_id", sa.String(36)),
        sa.Column("status", sa.String(20)),
        sa.Column("verification_basis", sa.String(30)),
        sa.Column("proposed_by", sa.String(36), nullable=True),
        sa.Column("proposed_at", sa.String(40)),
        sa.Column("expires_at", sa.String(40), nullable=True),
        sa.Column("approved_by_a", sa.String(36), nullable=True),
        sa.Column("approved_at_a", sa.String(40), nullable=True),
        sa.Column("approved_by_b", sa.String(36), nullable=True),
        sa.Column("approved_at_b", sa.String(40), nullable=True),
        sa.Column("verified_at", sa.String(40), nullable=True),
        sa.Column("decided_by", sa.String(36), nullable=True),
        sa.Column("decided_at", sa.String(40), nullable=True),
        sa.Column("decision_reason", sa.String(500), nullable=True),
        sa.Column("version", sa.Integer),
        sa.UniqueConstraint("member_a_id", "member_b_id"),
    )
    return meta


@pytest.fixture()
def engine(tmp_path):
    eng = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}", future=True)
    _build_schema().create_all(eng)
    yield eng
    eng.dispose()


def _seed(conn, meta) -> None:
    t = meta.tables
    conn.execute(
        t["workspaces"].insert(),
        [
            {"id": "wa", "owner_id": "alice", "name": "A"},
            {"id": "wb", "owner_id": "bob", "name": "B"},
            {"id": "wc", "owner_id": "alice", "name": "C"},
        ],
    )
    conn.execute(
        t["members"].insert(),
        [
            # A cross-owner bridge pair (wa/alice <-> wb/bob).
            {
                "id": "ma",
                "workspace_id": "wa",
                "linked_workspace_id": "wb",
                "linked_member_id": "mb",
            },
            {
                "id": "mb",
                "workspace_id": "wb",
                "linked_workspace_id": "wa",
                "linked_member_id": "ma",
            },
            # A same-owner bridge pair (wa/alice <-> wc/alice).
            {
                "id": "mc",
                "workspace_id": "wa",
                "linked_workspace_id": "wc",
                "linked_member_id": "md",
            },
            {
                "id": "md",
                "workspace_id": "wc",
                "linked_workspace_id": "wa",
                "linked_member_id": "mc",
            },
            # A dangling bridge pointer (counterpart row no longer exists):
            # must be skipped, not migrated as a one-sided link.
            {
                "id": "me",
                "workspace_id": "wa",
                "linked_workspace_id": "wb",
                "linked_member_id": "ghost",
            },
            # An unlinked member: must be ignored entirely.
            {
                "id": "mf",
                "workspace_id": "wa",
                "linked_workspace_id": None,
                "linked_member_id": None,
            },
        ],
    )


def _reflect(engine) -> sa.MetaData:
    meta = sa.MetaData()
    meta.reflect(bind=engine)
    return meta


def test_migrates_each_bridge_pair_exactly_once(engine):
    meta = _reflect(engine)
    with engine.begin() as conn:
        _seed(conn, meta)
        created = migration.migrate_legacy_bridges_to_identity_links(conn)
    assert created == 2

    docs = _reflect(engine).tables
    with engine.connect() as conn:
        links = conn.execute(sa.select(docs["identity_links"])).mappings().all()

    assert len(links) == 2
    pairs = {(link.member_a_id, link.member_b_id) for link in links}
    assert pairs == {("ma", "mb"), ("mc", "md")}
    for link in links:
        assert link.status == "verified"
        assert link.verification_basis == "legacy_dual_write_access"
        assert link.verified_at is not None
        assert link.version == 0


def test_notifies_each_distinct_current_owner_once(engine):
    meta = _reflect(engine)
    with engine.begin() as conn:
        _seed(conn, meta)
        migration.migrate_legacy_bridges_to_identity_links(conn)

    docs = _reflect(engine).tables
    with engine.connect() as conn:
        notifications = conn.execute(sa.select(docs["notifications"])).mappings().all()

    # Cross-owner pair (ma/mb) notifies both alice and bob; the same-owner
    # pair (mc/md, both alice) notifies alice only once, not twice.
    assert len(notifications) == 3
    by_user = {n.user_id: n for n in notifications}
    assert set(by_user) == {"alice", "bob"}
    assert sum(1 for n in notifications if n.user_id == "alice") == 2
    for n in notifications:
        assert n.type == "identity_link_legacy_migrated"
        payload = json.loads(n.payload)
        assert "identity_link_id" in payload


def test_noop_on_a_schema_with_no_bridges(engine):
    with engine.begin() as conn:
        created = migration.migrate_legacy_bridges_to_identity_links(conn)
    assert created == 0
