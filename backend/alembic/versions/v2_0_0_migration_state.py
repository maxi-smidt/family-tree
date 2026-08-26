"""Add durable v2 migration state: runs, mappings, reports, conflicts (#997).

Revision ID: v2_0_0_migration_state
Revises: v2_0_0_saved_views
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_migration_state"
down_revision: Union[str, None] = "v2_0_0_saved_views"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "migration_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_version", sa.String(length=20), nullable=False),
        sa.Column("target_version", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("phase", sa.String(length=20), nullable=False),
        sa.Column("checkpoint", sa.JSON(), nullable=True),
        sa.Column("backup_id", sa.String(length=36), nullable=True),
        sa.Column("backup_path", sa.String(length=500), nullable=True),
        sa.Column("started_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.Column("heartbeat_at", sa.String(length=40), nullable=True),
        sa.Column("completed_at", sa.String(length=40), nullable=True),
        sa.Column("finalized_at", sa.String(length=40), nullable=True),
        sa.Column("finalized_by", sa.String(length=36), nullable=True),
        sa.Column("failure_code", sa.String(length=60), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["finalized_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "migration_mappings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("source_workspace_id", sa.String(length=36), nullable=False),
        sa.Column("source_workspace_name", sa.String(length=255), nullable=False),
        sa.Column("target_workspace_id", sa.String(length=36), nullable=False),
        sa.Column("target_section_id", sa.String(length=36), nullable=True),
        sa.Column("is_survivor", sa.Boolean(), nullable=False),
        sa.Column("tie_break_inputs", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["migration_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "run_id", "source_workspace_id", name="uq_migration_mapping_source"
        ),
    )
    op.create_index(
        "ix_migration_mappings_run_id", "migration_mappings", ["run_id"]
    )
    op.create_index(
        "ix_migration_mappings_target_workspace_id",
        "migration_mappings",
        ["target_workspace_id"],
    )

    op.create_table(
        "migration_reports",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_mappings", sa.JSON(), nullable=False),
        sa.Column("grant_changes", sa.JSON(), nullable=False),
        sa.Column("converted_virtual_views", sa.JSON(), nullable=False),
        sa.Column("dropped_virtual_views", sa.JSON(), nullable=False),
        sa.Column("media_verification", sa.JSON(), nullable=False),
        sa.Column("validation_summary", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("acknowledged_by", sa.String(length=36), nullable=True),
        sa.Column("acknowledged_at", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["migration_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["owner_user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["acknowledged_by"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "owner_user_id", name="uq_migration_report_owner"),
    )
    op.create_index(
        "ix_migration_reports_owner_user_id", "migration_reports", ["owner_user_id"]
    )

    op.create_table(
        "migration_conflicts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("source_section_id", sa.String(length=36), nullable=True),
        sa.Column("member_a_id", sa.String(length=36), nullable=False),
        sa.Column("member_b_id", sa.String(length=36), nullable=False),
        sa.Column("conflicting_fields", sa.JSON(), nullable=False),
        sa.Column("conflicting_media", sa.JSON(), nullable=False),
        sa.Column("blocks_finalization", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("resolution", sa.JSON(), nullable=True),
        sa.Column("resolved_by", sa.String(length=36), nullable=True),
        sa.Column("resolved_at", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["migration_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["owner_user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "run_id",
            "kind",
            "member_a_id",
            "member_b_id",
            name="uq_migration_conflict_pair",
        ),
    )
    op.create_index(
        "ix_migration_conflicts_owner_user_id", "migration_conflicts", ["owner_user_id"]
    )
    op.create_index(
        "ix_migration_conflicts_workspace_id", "migration_conflicts", ["workspace_id"]
    )

    op.create_table(
        "migration_idempotency_keys",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("phase", sa.String(length=20), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("target_type", sa.String(length=30), nullable=False),
        sa.Column("target_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["migration_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("run_id", "phase", "key"),
    )


def downgrade() -> None:
    op.drop_table("migration_idempotency_keys")

    op.drop_index("ix_migration_conflicts_workspace_id", table_name="migration_conflicts")
    op.drop_index(
        "ix_migration_conflicts_owner_user_id", table_name="migration_conflicts"
    )
    op.drop_table("migration_conflicts")

    op.drop_index("ix_migration_reports_owner_user_id", table_name="migration_reports")
    op.drop_table("migration_reports")

    op.drop_index(
        "ix_migration_mappings_target_workspace_id", table_name="migration_mappings"
    )
    op.drop_index("ix_migration_mappings_run_id", table_name="migration_mappings")
    op.drop_table("migration_mappings")

    op.drop_table("migration_runs")
