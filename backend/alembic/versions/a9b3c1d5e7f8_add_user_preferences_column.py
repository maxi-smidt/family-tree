"""add user preferences column

Revision ID: a9b3c1d5e7f8
Revises: e1f2a3b4c5d6
Create Date: 2026-06-19 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a9b3c1d5e7f8"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("preferences", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "preferences")
