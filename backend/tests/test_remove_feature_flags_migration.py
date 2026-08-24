"""Coverage for removing obsolete runtime feature-flag storage."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "v1_10_0_remove_feature_flags.py"
    )
    spec = importlib.util.spec_from_file_location(
        "v1_10_0_remove_feature_flags_under_test", path
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migration = _load_migration_module()


def test_revision_id_fits_the_alembic_version_column():
    assert len(migration.revision) <= 32


def test_removes_feature_settings_and_legacy_override_table():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", sa.Text),
    )
    overrides = sa.Table(
        "feature_flag_overrides",
        metadata,
        sa.Column("feature", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.String(36), primary_key=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {"key": "feature.gallery", "value": "off"},
                {"key": "feature.statistics", "value": "beta"},
                {"key": "instance_name", "value": "Family Workspace"},
            ],
        )
        connection.execute(
            overrides.insert(),
            {"feature": "gallery", "user_id": "user-1"},
        )

        migration.remove_feature_flag_storage(connection)

        remaining_keys = (
            connection.execute(sa.select(settings.c.key).order_by(settings.c.key))
            .scalars()
            .all()
        )
        remaining_tables = set(sa.inspect(connection).get_table_names())

    engine.dispose()
    assert remaining_keys == ["instance_name"]
    assert "feature_flag_overrides" not in remaining_tables
