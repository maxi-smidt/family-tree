"""Add section-scoped grants, public links, and invitation scope (#993).

Revision ID: v2_0_0_scoped_grants
Revises: v2_0_0_content_scopes
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_scoped_grants"
down_revision: Union[str, None] = "v2_0_0_content_scopes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing workspace_memberships/Workspace.public_* rows are untouched:
    # they *are* the workspace-wide grant/link every share used before this
    # landed, so no data migration is needed for the common case (#993).
    op.add_column(
        "workspace_invitations",
        sa.Column("section_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_workspace_invitations_section",
        "workspace_invitations",
        "sections",
        ["workspace_id", "section_id"],
        ["workspace_id", "id"],
        ondelete="RESTRICT",
    )

    op.create_table(
        "workspace_section_grants",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("restrictions", sa.JSON(), nullable=True),
        sa.Column("access_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            name="fk_section_grants_section",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "user_id", "section_id", name="uq_section_grant_scope"
        ),
    )
    op.create_index(
        "ix_section_grants_workspace_user",
        "workspace_section_grants",
        ["workspace_id", "user_id"],
    )
    op.create_index(
        op.f("ix_workspace_section_grants_workspace_id"),
        "workspace_section_grants",
        ["workspace_id"],
    )
    op.create_index(
        op.f("ix_workspace_section_grants_user_id"),
        "workspace_section_grants",
        ["user_id"],
    )

    op.create_table(
        "workspace_section_public_links",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("access_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            name="fk_section_public_links_section",
            # RESTRICT (unlike the invitations FK above) is safe here: a
            # row only ever exists while its link is live — revoking one
            # deletes it (see revoke_section_public_link) — so RESTRICT
            # correctly blocks section deletion only while a *live* link
            # still references it.
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_section_public_links_workspace_section",
        "workspace_section_public_links",
        ["workspace_id", "section_id"],
    )
    op.create_index(
        op.f("ix_workspace_section_public_links_workspace_id"),
        "workspace_section_public_links",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_workspace_section_public_links_workspace_id"),
        table_name="workspace_section_public_links",
    )
    op.drop_index(
        "ix_section_public_links_workspace_section",
        table_name="workspace_section_public_links",
    )
    op.drop_table("workspace_section_public_links")

    op.drop_index(
        op.f("ix_workspace_section_grants_user_id"),
        table_name="workspace_section_grants",
    )
    op.drop_index(
        op.f("ix_workspace_section_grants_workspace_id"),
        table_name="workspace_section_grants",
    )
    op.drop_index(
        "ix_section_grants_workspace_user", table_name="workspace_section_grants"
    )
    op.drop_table("workspace_section_grants")

    op.drop_constraint(
        "fk_workspace_invitations_section", "workspace_invitations", type_="foreignkey"
    )
    op.drop_column("workspace_invitations", "section_id")
