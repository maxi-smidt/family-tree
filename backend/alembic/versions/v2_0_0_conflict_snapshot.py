"""Capture bridge-drift field/photo values on migration_conflicts so a
"merge" resolution has a value to apply once the non-canonical row is gone
(#1018).

Revision ID: v2_0_0_conflict_snapshot
Revises: v2_0_0_migration_source_idx
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_conflict_snapshot"
down_revision: Union[str, None] = "v2_0_0_migration_source_idx"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "migration_conflicts",
        sa.Column("canonical_member_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "migration_conflicts",
        sa.Column(
            "field_values",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.alter_column("migration_conflicts", "field_values", server_default=None)


def downgrade() -> None:
    op.drop_column("migration_conflicts", "field_values")
    op.drop_column("migration_conflicts", "canonical_member_id")
