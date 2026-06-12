"""feature flag overrides

Per-user allowlist rows for feature flags in the ``beta`` state. The flags'
global states live in the existing ``app_settings`` table (``feature.<name>``
keys), so this is the only new table the flag system needs.

Revision ID: f8c1d2e3a4b5
Revises: e5a1b2c3d4f6
Create Date: 2026-06-12 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f8c1d2e3a4b5'
down_revision: Union[str, None] = 'e5a1b2c3d4f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'feature_flag_overrides',
        sa.Column('feature', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('feature', 'user_id'),
    )


def downgrade() -> None:
    op.drop_table('feature_flag_overrides')
