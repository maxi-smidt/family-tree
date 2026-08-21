"""v1.9.0 restore markers

Adds ``restore_markers``, the commit witness for atomic instance restores: a
row is inserted in the same transaction as the restored rows during
``backup_service.restore_bundle``, so its presence after a crash is proof the
transaction actually committed (used by ``reconcile_interrupted_restore`` on
startup to decide whether to roll a swapped media directory forward or back).

Revision ID: v1_9_0_restore_markers
Revises: v1_8_0_release
Create Date: 2026-08-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "v1_9_0_restore_markers"
down_revision: Union[str, None] = "v1_8_0_release"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "restore_markers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_restore_markers_created_at"),
        "restore_markers",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_restore_markers_created_at"), table_name="restore_markers")
    op.drop_table("restore_markers")
