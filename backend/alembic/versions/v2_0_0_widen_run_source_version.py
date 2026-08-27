"""Widen MigrationRun.source_version (#998).

Revision ID: v2_0_0_widen_run_source_version
Revises: v2_0_0_member_name_search_index
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_widen_run_source_version"
down_revision: Union[str, None] = "v2_0_0_member_name_search_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # app.services.migration.orchestrator._source_version stores the current
    # Alembic head id(s) here (e.g. "v2_0_0_member_name_search_index", 32
    # chars) when no prior run exists, not a short semver like
    # target_version's "2.0.0" — the original String(20) truncates on every
    # real Postgres upgrade (SQLite silently ignores VARCHAR length instead
    # of raising, which is why this went unnoticed until a real-Postgres run).
    op.alter_column(
        "migration_runs",
        "source_version",
        type_=sa.String(length=255),
        existing_type=sa.String(length=20),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "migration_runs",
        "source_version",
        type_=sa.String(length=20),
        existing_type=sa.String(length=255),
        existing_nullable=False,
    )
