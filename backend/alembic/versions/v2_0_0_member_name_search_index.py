"""Add Member.name_normalized and a trigram index for workspace search (#1024).

Revision ID: v2_0_0_member_name_search_index
Revises: v2_0_0_conflict_snapshot
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_member_name_search_index"
down_revision: Union[str, None] = "v2_0_0_conflict_snapshot"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "members",
        sa.Column(
            "name_normalized", sa.String(length=800), server_default="", nullable=False
        ),
    )
    # Backfill existing rows from the same three fields the ORM validator
    # derives new ones from (see Member._derive_name_normalized).
    op.execute(
        """
        UPDATE members
        SET name_normalized = lower(trim(concat_ws(' ', first_name, last_name, maiden_name)))
        """
    )
    # pg_trgm ships in the standard postgres/postgres-alpine image (contrib
    # module) — no extra image or package required.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX ix_members_name_normalized_trgm ON members "
        "USING gin (name_normalized gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_members_name_normalized_trgm")
    op.drop_column("members", "name_normalized")
