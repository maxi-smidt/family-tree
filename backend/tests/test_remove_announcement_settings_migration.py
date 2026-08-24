"""Tests for the data cleanup in the What's New migration.

Retention: data-migration tests are kept for the current + prior minor
release (currently 1.8/1.7); delete this file once 1.9 ships and this
migration is more than one minor version old.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "v1_7_0_release.py"
    )
    spec = importlib.util.spec_from_file_location("remove_announcement_settings", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migration = _load_migration_module()


def test_revision_id_fits_the_alembic_version_column():
    assert len(migration.revision) <= 32


@pytest.fixture()
def engine():
    engine = sa.create_engine("sqlite://")
    yield engine
    engine.dispose()


def test_cleanup_removes_only_obsolete_announcement_settings(engine):
    metadata = sa.MetaData()
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", sa.Text()),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {"key": "announcement_title", "value": "Title"},
                {"key": "announcement_body", "value": "Body"},
                {"key": "announcement_version", "value": "1.2.3"},
                {"key": "instance_name", "value": "Family Workspace"},
            ],
        )

        migration.remove_obsolete_announcement_settings(connection)

        remaining_keys = (
            connection.execute(sa.select(settings.c.key).order_by(settings.c.key))
            .scalars()
            .all()
        )

    assert remaining_keys == ["instance_name"]
