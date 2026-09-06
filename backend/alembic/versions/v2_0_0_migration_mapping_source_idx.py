"""Index migration_mappings.source_workspace_id for the public legacy-id
lookup (#1012).

Revision ID: v2_0_0_migration_source_idx
Revises: v2_0_0_migration_state
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "v2_0_0_migration_source_idx"
down_revision: Union[str, None] = "v2_0_0_migration_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # uq_migration_mapping_source (run_id, source_workspace_id) doesn't serve
    # a lookup filtering on source_workspace_id alone across every run.
    op.create_index(
        "ix_migration_mappings_source_workspace_id",
        "migration_mappings",
        ["source_workspace_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_migration_mappings_source_workspace_id", table_name="migration_mappings"
    )
