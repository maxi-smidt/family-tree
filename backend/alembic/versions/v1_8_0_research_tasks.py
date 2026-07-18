"""Add member_tasks + member_task_link — research to-dos linked to any number
of members (no links = tree-level task).

Revision ID: v1_8_0_research_tasks
Revises: v1_8_0_user_profiles
Create Date: 2026-07-18 09:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v1_8_0_research_tasks"
down_revision: Union[str, None] = "v1_8_0_user_profiles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_table("member_task_link")
    op.drop_index(op.f("ix_member_tasks_tree_id"), table_name="member_tasks")
    op.drop_table("member_tasks")
