"""user_tab_preferences

Revision ID: 6bf0b5bfa3d5
Revises: 0f4fa5c07697
Create Date: 2026-06-11 21:40:58.063143

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6bf0b5bfa3d5'
down_revision: Union[str, None] = '0f4fa5c07697'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("tab_preferences", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "tab_preferences")
