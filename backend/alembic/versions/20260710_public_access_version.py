"""Revoke public-tree unlock tokens when access settings change.

Revision ID: 20260710_public_access_version
Revises: v1_9_0_admin_audit_trail
Create Date: 2026-07-10 16:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260710_public_access_version"
down_revision: Union[str, None] = "v1_9_0_admin_audit_trail"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "trees",
        sa.Column(
            "public_access_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("trees", "public_access_version")
