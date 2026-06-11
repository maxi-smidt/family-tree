"""virtual view match groups and position overlay

Revision ID: e5a1b2c3d4f6
Revises: d4e8f2c1a7b3
Create Date: 2026-06-11 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e5a1b2c3d4f6"
down_revision = "d4e8f2c1a7b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "virtual_views",
        sa.Column("matches_computed_at", sa.String(40), nullable=True),
    )

    op.create_table(
        "virtual_view_member_matches",
        sa.Column("view_id", sa.String(40), nullable=False),
        sa.Column("member_id", sa.String(36), nullable=False),
        sa.Column("group_id", sa.String(40), nullable=False),
        sa.Column(
            "is_primary", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.ForeignKeyConstraint(
            ["view_id"], ["virtual_views.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["member_id"], ["members.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("view_id", "member_id"),
    )
    op.create_index(
        "ix_vvmm_view_group",
        "virtual_view_member_matches",
        ["view_id", "group_id"],
    )

    op.create_table(
        "virtual_view_positions",
        sa.Column("view_id", sa.String(40), nullable=False),
        sa.Column("node_id", sa.String(40), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(
            ["view_id"], ["virtual_views.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("view_id", "node_id"),
    )


def downgrade() -> None:
    op.drop_table("virtual_view_positions")
    op.drop_index("ix_vvmm_view_group", table_name="virtual_view_member_matches")
    op.drop_table("virtual_view_member_matches")
    op.drop_column("virtual_views", "matches_computed_at")
