"""add geocode_cache table for map view

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "geocode_cache",
        sa.Column("query", sa.String(255), nullable=False),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("display_name", sa.String(512), nullable=True),
        sa.Column(
            "resolved", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.PrimaryKeyConstraint("query"),
    )


def downgrade() -> None:
    op.drop_table("geocode_cache")
