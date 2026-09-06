"""Tests for the metadata-only tree-to-workspace migration."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "v2_0_0_rename_workspaces.py"
    )
    spec = importlib.util.spec_from_file_location(
        "v2_0_0_rename_workspaces_under_test", path
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migration = _load_migration_module()


def test_upgrade_and_downgrade_rename_tables_columns_and_data():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    table_columns = {
        "trees": [sa.Column("id", sa.String(36), primary_key=True)],
        "tree_memberships": [
            sa.Column("tree_id", sa.String(36)),
            sa.Column("user_id", sa.String(36)),
        ],
        "tree_user_states": [
            sa.Column("tree_id", sa.String(36)),
            sa.Column("user_id", sa.String(36)),
        ],
        "tree_invitations": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "background_jobs": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("result_tree_id", sa.String(36)),
        ],
        "activity_log": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "events": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "gallery_images": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "members": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
            sa.Column("linked_tree_id", sa.String(36)),
        ],
        "stories": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "virtual_view_sources": [
            sa.Column("view_id", sa.String(36)),
            sa.Column("position", sa.Integer, primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "quality_issue_dismissals": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "documents": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "document_files": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "document_uploads": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "member_tasks": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "member_diseases": [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("tree_id", sa.String(36)),
        ],
        "relations": [
            sa.Column("tree_id", sa.String(36), primary_key=True),
            sa.Column("from_member_id", sa.String(36), primary_key=True),
            sa.Column("to_member_id", sa.String(36), primary_key=True),
            sa.Column("relation_type", sa.String(50), primary_key=True),
        ],
    }
    tables = {
        name: sa.Table(name, metadata, *columns)
        for name, columns in table_columns.items()
    }
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(tables["trees"].insert(), {"id": "workspace-1"})
        connection.execute(
            tables["members"].insert(),
            {"id": "member-1", "tree_id": "workspace-1", "linked_tree_id": None},
        )
        operations = Operations(MigrationContext.configure(connection))
        with Operations.context(operations):
            migration.upgrade()

        assert "trees" not in sa.inspect(connection).get_table_names()
        assert "workspaces" in sa.inspect(connection).get_table_names()
        members = sa.Table("members", sa.MetaData(), autoload_with=connection)
        assert {column.name for column in members.columns} >= {
            "workspace_id",
            "linked_workspace_id",
        }
        assert (
            connection.execute(sa.select(members.c.workspace_id)).scalar_one()
            == "workspace-1"
        )

        with Operations.context(operations):
            migration.downgrade()

        assert "trees" in sa.inspect(connection).get_table_names()
        assert "workspaces" not in sa.inspect(connection).get_table_names()
        members = sa.Table("members", sa.MetaData(), autoload_with=connection)
        assert {column.name for column in members.columns} >= {
            "tree_id",
            "linked_tree_id",
        }

    engine.dispose()
