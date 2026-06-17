"""add user quota columns

Revision ID: a1b2c3d4e5f6
Revises: f8c1d2e3a4b5
Create Date: 2026-06-17 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "f8c1d2e3a4b5"
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
