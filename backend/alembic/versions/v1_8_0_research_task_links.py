"""Repair early research-task schemas and migrate their member links.

An unreleased development build of ``v1_8_0_research_tasks`` created a
nullable ``member_tasks.member_id`` column.  That revision was later updated
in place to support multiple members per task, but databases that had already
recorded the revision never created ``member_task_link``.  Upgrade those
databases forward without losing their existing person-linked tasks.

Revision ID: v1_8_0_research_task_links
Revises: v1_8_0_research_tasks
Create Date: 2026-07-18 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v1_8_0_research_task_links"
down_revision: Union[str, None] = "v1_8_0_research_tasks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _create_member_tasks_table() -> None:
    """Create the final task table when a partially applied DB lacks it."""
    op.create_table(
        "member_tasks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("done_at", sa.String(length=40), nullable=True),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_member_tasks_tree_id"), "member_tasks", ["tree_id"], unique=False
    )


def _create_member_task_link_table() -> None:
    op.create_table(
        "member_task_link",
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["task_id"], ["member_tasks.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("task_id", "member_id"),
    )


def migrate_legacy_member_task_links(connection: sa.Connection) -> None:
    """Copy non-null legacy ``member_id`` values into the link table.

    The Core statement is deliberately idempotent so a manually repaired
    development database can still be upgraded safely.
    """
    legacy_tasks = sa.table(
        "member_tasks",
        sa.column("id", sa.String(length=36)),
        sa.column("member_id", sa.String(length=36)),
    )
    task_links = sa.table(
        "member_task_link",
        sa.column("task_id", sa.String(length=36)),
        sa.column("member_id", sa.String(length=36)),
    )
    already_linked = sa.exists(
        sa.select(1).where(
            task_links.c.task_id == legacy_tasks.c.id,
            task_links.c.member_id == legacy_tasks.c.member_id,
        )
    )
    connection.execute(
        task_links.insert().from_select(
            ["task_id", "member_id"],
            sa.select(legacy_tasks.c.id, legacy_tasks.c.member_id).where(
                legacy_tasks.c.member_id.is_not(None), ~already_linked
            ),
        )
    )


def _has_column(connection: sa.Connection, table_name: str, column_name: str) -> bool:
    return column_name in {
        column["name"] for column in sa.inspect(connection).get_columns(table_name)
    }


def _drop_legacy_member_id(connection: sa.Connection) -> None:
    """Remove legacy indexes and constraints before dropping ``member_id``."""
    inspector = sa.inspect(connection)
    for index in inspector.get_indexes("member_tasks"):
        if "member_id" in index["column_names"]:
            op.drop_index(index["name"], table_name="member_tasks")
    for foreign_key in inspector.get_foreign_keys("member_tasks"):
        if foreign_key["constrained_columns"] == ["member_id"] and foreign_key["name"]:
            op.drop_constraint(
                foreign_key["name"], "member_tasks", type_="foreignkey"
            )
    op.drop_column("member_tasks", "member_id")


def upgrade() -> None:
    connection = op.get_bind()
    table_names = set(sa.inspect(connection).get_table_names())

    if "member_tasks" not in table_names:
        _create_member_tasks_table()
        table_names.add("member_tasks")
    if "member_task_link" not in table_names:
        _create_member_task_link_table()

    if _has_column(connection, "member_tasks", "member_id"):
        migrate_legacy_member_task_links(connection)
        _drop_legacy_member_id(connection)


def downgrade() -> None:
    connection = op.get_bind()
    table_names = set(sa.inspect(connection).get_table_names())
    if "member_tasks" not in table_names:
        return

    if not _has_column(connection, "member_tasks", "member_id"):
        op.add_column(
            "member_tasks", sa.Column("member_id", sa.String(length=36), nullable=True)
        )
        op.create_foreign_key(
            "fk_member_tasks_member_id_members",
            "member_tasks",
            "members",
            ["member_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_index(
            op.f("ix_member_tasks_member_id"),
            "member_tasks",
            ["member_id"],
            unique=False,
        )

    if "member_task_link" in table_names:
        legacy_tasks = sa.table(
            "member_tasks",
            sa.column("id", sa.String(length=36)),
            sa.column("member_id", sa.String(length=36)),
        )
        task_links = sa.table(
            "member_task_link",
            sa.column("task_id", sa.String(length=36)),
            sa.column("member_id", sa.String(length=36)),
        )
        connection.execute(
            legacy_tasks.update().values(
                member_id=sa.select(sa.func.min(task_links.c.member_id))
                .where(task_links.c.task_id == legacy_tasks.c.id)
                .scalar_subquery()
            )
        )
        op.drop_table("member_task_link")
