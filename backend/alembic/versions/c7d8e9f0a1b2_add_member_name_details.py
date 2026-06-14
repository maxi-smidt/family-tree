"""add member name details

Revision ID: c7d8e9f0a1b2
Revises: 4a2bc8144c1c
Create Date: 2026-06-15

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "4a2bc8144c1c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "members", sa.Column("middleNames", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "members", sa.Column("baptismalName", sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("members", "baptismalName")
    op.drop_column("members", "middleNames")
