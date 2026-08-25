"""Add saved views: config, section filter, layout overlay, per-user state (#986).

Revision ID: v2_0_0_saved_views
Revises: v2_0_0_identity_links
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_saved_views"
down_revision: Union[str, None] = "v2_0_0_identity_links"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saved_views",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("owner_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("focus_member_id", sa.String(length=36), nullable=True),
        sa.Column("ancestor_depth", sa.Integer(), nullable=False),
        sa.Column("descendant_depth", sa.Integer(), nullable=False),
        sa.Column(
            "include_partners",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column("config_version", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "focus_member_id"],
            ["members.workspace_id", "members.id"],
            ondelete="RESTRICT",
            name="fk_saved_views_focus_member",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "id", name="uq_saved_view_workspace_id_id"
        ),
    )
    op.create_index(
        op.f("ix_saved_views_workspace_id"), "saved_views", ["workspace_id"], unique=False
    )
    op.create_index(
        op.f("ix_saved_views_owner_id"), "saved_views", ["owner_id"], unique=False
    )

    op.create_table(
        "saved_view_sections",
        sa.Column("saved_view_id", sa.String(length=40), nullable=False),
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["saved_view_id"], ["saved_views.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            ondelete="RESTRICT",
            name="fk_saved_view_sections_section",
        ),
        sa.PrimaryKeyConstraint("saved_view_id", "section_id"),
    )

    op.create_table(
        "saved_view_positions",
        sa.Column("saved_view_id", sa.String(length=40), nullable=False),
        sa.Column("node_id", sa.String(length=40), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(
            ["saved_view_id"], ["saved_views.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("saved_view_id", "node_id"),
    )

    op.create_table(
        "saved_view_user_states",
        sa.Column("saved_view_id", sa.String(length=40), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("last_opened", sa.String(length=40), nullable=False),
        sa.Column("camera_x", sa.Float(), nullable=True),
        sa.Column("camera_y", sa.Float(), nullable=True),
        sa.Column("camera_zoom", sa.Float(), nullable=True),
        sa.Column("collapsed_node_ids", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["saved_view_id"], ["saved_views.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("saved_view_id", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("saved_view_user_states")
    op.drop_table("saved_view_positions")
    op.drop_table("saved_view_sections")
    op.drop_index(op.f("ix_saved_views_owner_id"), table_name="saved_views")
    op.drop_index(op.f("ix_saved_views_workspace_id"), table_name="saved_views")
    op.drop_table("saved_views")
