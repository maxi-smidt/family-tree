"""add user quota columns

Revision ID: c4e8a1b3d5f7
Revises: d7a3f9b21c84
Create Date: 2026-06-17 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c4e8a1b3d5f7"
down_revision = "d7a3f9b21c84"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("tree_quota_bytes", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("media_quota_bytes", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("total_quota_bytes", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "total_quota_bytes")
    op.drop_column("users", "media_quota_bytes")
    op.drop_column("users", "tree_quota_bytes")
