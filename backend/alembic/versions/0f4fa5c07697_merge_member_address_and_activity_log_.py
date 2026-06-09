"""merge member address and activity log details heads

Revision ID: 0f4fa5c07697
Revises: 33f4e60a0150, a1f2e3d4c5b6
Create Date: 2026-06-09 12:53:28.590366

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0f4fa5c07697'
down_revision: Union[str, None] = ('33f4e60a0150', 'a1f2e3d4c5b6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
