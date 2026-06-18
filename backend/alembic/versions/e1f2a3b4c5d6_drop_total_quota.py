"""drop the total storage quota (now reported as tree + media)

The total is no longer an independently configurable limit: usage is reported
as the sum of the tree-data and media buckets, so the per-user
``users.total_quota_bytes`` column and the ``default_total_quota_mb`` instance
setting are removed.

Revision ID: e1f2a3b4c5d6
Revises: c4e8a1b3d5f7
Create Date: 2026-06-18 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e1f2a3b4c5d6"
down_revision = "c4e8a1b3d5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("users", "total_quota_bytes")
    op.execute(
        sa.text("DELETE FROM app_settings WHERE key = 'default_total_quota_mb'")
    )


def downgrade() -> None:
    # The instance-default setting row is re-seeded on startup by older code.
    op.add_column(
        "users", sa.Column("total_quota_bytes", sa.BigInteger(), nullable=True)
    )
