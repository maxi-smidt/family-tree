"""v1.8.0 — optional password for publicly shared trees

Revision ID: v1_8_0_public_tree_password
Revises: v1_7_0_documents
Create Date: 2026-07-08 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_8_0_public_tree_password'
down_revision: Union[str, None] = 'v1_7_0_documents'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'trees', sa.Column('public_password_hash', sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('trees', 'public_password_hash')
