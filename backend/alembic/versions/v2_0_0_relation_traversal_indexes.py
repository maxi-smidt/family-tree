"""Add relation traversal indexes for the neighborhood API (#983).

Revision ID: v2_0_0_relation_idx
Revises: v2_0_0_sections
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "v2_0_0_relation_idx"
down_revision: Union[str, None] = "v2_0_0_sections"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Built non-concurrently, so each takes a SHARE lock on ``relations`` for
    # the duration. Migrations run at container start before the app serves
    # traffic, so this only stalls writes from another replica mid-deploy.
    op.create_index(
        "ix_relations_workspace_type_from",
        "relations",
        ["workspace_id", "relation_type", "from_member_id"],
        unique=False,
    )
    op.create_index(
        "ix_relations_workspace_type_to",
        "relations",
        ["workspace_id", "relation_type", "to_member_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_relations_workspace_type_to", table_name="relations")
    op.drop_index("ix_relations_workspace_type_from", table_name="relations")
