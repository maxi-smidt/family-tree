"""Data migration coverage for the early research-task development schema."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "v1_8_0_research_task_links.py"
    )
    spec = importlib.util.spec_from_file_location(
        "v1_8_0_research_task_links_under_test", path
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


migration = _load_migration_module()


def test_migrates_legacy_person_links_without_touching_tree_tasks(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}", future=True)
    meta = sa.MetaData()
    tasks = sa.Table(
        "member_tasks",
        meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("member_id", sa.String(36), nullable=True),
    )
    links = sa.Table(
        "member_task_link",
        meta,
        sa.Column("task_id", sa.String(36), primary_key=True),
        sa.Column("member_id", sa.String(36), primary_key=True),
    )
    meta.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            tasks.insert(),
            [
                {"id": "person-task", "member_id": "member-1"},
                {"id": "tree-task", "member_id": None},
            ],
        )
        migration.migrate_legacy_member_task_links(connection)
        # The operation is safe if an operator already copied a link manually.
        migration.migrate_legacy_member_task_links(connection)

    with engine.connect() as connection:
        assert set(connection.execute(sa.select(links))) == {
            ("person-task", "member-1")
        }

    engine.dispose()
