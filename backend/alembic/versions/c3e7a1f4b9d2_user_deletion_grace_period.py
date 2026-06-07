"""user soft-deletion grace period

Adds the columns that mark an account as pending deletion during the
admin-configurable grace period before it is purged.

Revision ID: c3e7a1f4b9d2
Revises: b2d9f3a1c7e4
Create Date: 2026-06-07 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3e7a1f4b9d2'
down_revision: Union[str, None] = 'b2d9f3a1c7e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('deletion_requested_at', sa.String(length=40), nullable=True)
        )
        batch_op.add_column(
            sa.Column('deletion_scheduled_for', sa.String(length=40), nullable=True)
        )
        batch_op.add_column(
            sa.Column('deletion_requested_by', sa.String(length=36), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('deletion_requested_by')
        batch_op.drop_column('deletion_scheduled_for')
        batch_op.drop_column('deletion_requested_at')
