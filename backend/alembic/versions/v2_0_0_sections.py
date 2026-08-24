"""Add sections, section membership, and per-section layout (#982).

Revision ID: v2_0_0_sections
Revises: v2_0_0_rename_workspaces
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_sections"
down_revision: Union[str, None] = "v2_0_0_rename_workspaces"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_section_workspace_name"),
    )
    op.create_index(
        op.f("ix_sections_workspace_id"), "sections", ["workspace_id"], unique=False
    )

    op.create_table(
        "section_members",
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("section_id", "member_id"),
    )
    op.create_index(
        op.f("ix_section_members_member_id"),
        "section_members",
        ["member_id"],
        unique=False,
    )

    op.create_table(
        "section_positions",
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("section_id", "member_id"),
    )


def downgrade() -> None:
    op.drop_table("section_positions")
    op.drop_index(op.f("ix_section_members_member_id"), table_name="section_members")
    op.drop_table("section_members")
    op.drop_index(op.f("ix_sections_workspace_id"), table_name="sections")
    op.drop_table("sections")
