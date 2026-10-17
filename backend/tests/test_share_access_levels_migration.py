"""Coverage for folding legacy share toggles into the #1101 areas."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "v2_0_0_share_access_levels.py"
    )
    spec = importlib.util.spec_from_file_location(
        "v2_0_0_share_access_levels_under_test", path
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migration = _load_migration_module()


def test_legacy_toggles_fold_into_areas():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    memberships = sa.Table(
        "workspace_memberships",
        metadata,
        sa.Column("workspace_id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), primary_key=True),
        sa.Column("restrictions", sa.JSON, nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            memberships.insert(),
            [
                {"workspace_id": "w", "user_id": "a", "restrictions": ["map", "tree"]},
                {"workspace_id": "w", "user_id": "b", "restrictions": ["biography"]},
                {"workspace_id": "w", "user_id": "c", "restrictions": ["tree"]},
                {"workspace_id": "w", "user_id": "d", "restrictions": ["gallery"]},
                {"workspace_id": "w", "user_id": "e", "restrictions": None},
            ],
        )

        migration.migrate_restrictions(
            connection, "workspace_memberships", ("workspace_id", "user_id")
        )

        rows = dict(
            connection.execute(
                sa.select(memberships.c.user_id, memberships.c.restrictions)
            ).all()
        )

    engine.dispose()
    assert rows == {
        "a": ["events"],
        "b": ["stories"],
        "c": None,
        "d": ["gallery"],
        "e": None,
    }
