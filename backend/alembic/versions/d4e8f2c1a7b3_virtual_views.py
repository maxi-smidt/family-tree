"""virtual_views

Revision ID: d4e8f2c1a7b3
Revises: 6bf0b5bfa3d5
Create Date: 2026-06-11 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e8f2c1a7b3"
down_revision: Union[str, None] = "6bf0b5bfa3d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "virtual_views",
        sa.Column("id", sa.String(40), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("owner_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("last_opened", sa.String(40), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_virtual_views_owner_id", "virtual_views", ["owner_id"])

    op.create_table(
        "virtual_view_sources",
        sa.Column("view_id", sa.String(40), nullable=False),
        sa.Column("tree_id", sa.String(36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["view_id"], ["virtual_views.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("view_id", "tree_id"),
    )


def downgrade() -> None:
    op.drop_table("virtual_view_sources")
    op.drop_index("ix_virtual_views_owner_id", table_name="virtual_views")
    op.drop_table("virtual_views")
