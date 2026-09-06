"""Widen MigrationIdempotencyKey.target_id (#992).

Revision ID: v2_0_0_idempotency_target_id
Revises: 4c8b74c22044
Create Date: 2026-09-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_idempotency_target_id"
down_revision: Union[str, None] = "4c8b74c22044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # app.services.migration.converter._convert_virtual_views records a
    # SavedView's id here ("sv_" + uuid, 39 chars) — the original String(36)
    # truncates on every real Postgres virtual-view conversion (SQLite
    # silently ignores VARCHAR length instead of raising, which is why this
    # went unnoticed until real-Postgres migration coverage exercised it).
    op.alter_column(
        "migration_idempotency_keys",
        "target_id",
        type_=sa.String(length=64),
        existing_type=sa.String(length=36),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "migration_idempotency_keys",
        "target_id",
        type_=sa.String(length=36),
        existing_type=sa.String(length=64),
        existing_nullable=False,
    )
