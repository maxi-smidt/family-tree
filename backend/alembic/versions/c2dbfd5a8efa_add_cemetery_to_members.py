"""add cemetery to members

Revision ID: c2dbfd5a8efa
Revises: 5f37813d4464
Create Date: 2026-07-01 17:30:26.152952

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2dbfd5a8efa'
down_revision: Union[str, None] = '5f37813d4464'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('members', sa.Column('cemetery', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('members', 'cemetery')
