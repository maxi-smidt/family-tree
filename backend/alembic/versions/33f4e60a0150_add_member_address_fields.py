"""add member address fields

Revision ID: 33f4e60a0150
Revises: 87c30f3577eb
Create Date: 2026-06-09 09:24:30.703172

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '33f4e60a0150'
down_revision: Union[str, None] = '87c30f3577eb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("members", sa.Column("birthplace", sa.String(255), nullable=True))
    op.add_column("members", sa.Column("hometown", sa.String(255), nullable=True))
    op.add_column("members", sa.Column("placesLived", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("members", "placesLived")
    op.drop_column("members", "hometown")
    op.drop_column("members", "birthplace")
