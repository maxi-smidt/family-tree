"""Add content provenance scopes (#1023).

Revision ID: v2_0_0_content_scopes
Revises: v2_0_0_relation_idx
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_content_scopes"
down_revision: Union[str, None] = "v2_0_0_relation_idx"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (content type, table). Every content domain that carries an independent
# origin scope; anything else inherits its audience from a parent row.
CONTENT_TABLES: tuple[tuple[str, str], ...] = (
    ("event", "events"),
    ("story", "stories"),
    ("document", "documents"),
    ("gallery_image", "gallery_images"),
    ("task", "member_tasks"),
    ("disease", "member_diseases"),
)

# member_diseases has no created_at column of its own.
SEEDED_AT = "1970-01-01T00:00:00+00:00"


def upgrade() -> None:
    # Parent key for the composite FK below, so the database can reject a
    # scope whose section belongs to a different workspace.
    op.create_unique_constraint(
        "uq_section_workspace_id_id", "sections", ["workspace_id", "id"]
    )

    op.create_table(
        "content_scopes",
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("content_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("section_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            name="fk_content_scopes_section",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("content_type", "content_id"),
    )
    op.create_index(
        op.f("ix_content_scopes_workspace_id"),
        "content_scopes",
        ["workspace_id"],
        unique=False,
    )
    op.create_index(
        "ix_content_scopes_workspace_id_section_id",
        "content_scopes",
        ["workspace_id", "section_id"],
        unique=False,
    )

    # Seed every existing record as workspace-wide. That is what its audience
    # actually was before provenance existed: no grant could be narrower than
    # the workspace, so nobody's visibility changes here.
    for content_type, table in CONTENT_TABLES:
        created_at = "created_at" if table != "member_diseases" else f"'{SEEDED_AT}'"
        op.execute(
            sa.text(
                f"""
                INSERT INTO content_scopes
                    (content_type, content_id, workspace_id, section_id, created_at)
                SELECT '{content_type}', id, workspace_id, NULL,
                       COALESCE({created_at}, '{SEEDED_AT}')
                FROM {table}
                """  # noqa: S608 - fixed table names from CONTENT_TABLES
            )
        )


def downgrade() -> None:
    op.drop_index(
        "ix_content_scopes_workspace_id_section_id", table_name="content_scopes"
    )
    op.drop_index(op.f("ix_content_scopes_workspace_id"), table_name="content_scopes")
    op.drop_table("content_scopes")
    op.drop_constraint("uq_section_workspace_id_id", "sections", type_="unique")
