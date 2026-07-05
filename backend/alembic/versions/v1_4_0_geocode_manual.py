"""v1.4.0 — add geocode_cache.manual (manual pin / geocode override flag)

Revision ID: v1_4_0_geocode_manual
Revises: v1_4_0_member_linked_tree
Create Date: 2026-07-05 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_4_0_geocode_manual'
down_revision: Union[str, None] = 'v1_4_0_member_linked_tree'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Marks a geocode_cache row as a user-supplied correction (search pick or
    # manually dropped pin) so the retry/TTL logic never re-geocodes or
    # overwrites it.
    op.add_column(
        'geocode_cache',
        sa.Column(
            'manual', sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column('geocode_cache', 'manual')
