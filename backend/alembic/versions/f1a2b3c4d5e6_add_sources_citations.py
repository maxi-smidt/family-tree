"""add sources, source_evidence, citations tables

Revision ID: f1a2b3c4d5e6
Revises: e5f6a7b8c9d0
Create Date: 2026-06-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sources",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("tree_id", sa.String(36), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("author", sa.String(255), nullable=True),
        sa.Column("publication_info", sa.Text(), nullable=True),
        sa.Column("repository", sa.String(255), nullable=True),
        sa.Column("source_date", sa.String(40), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sources_tree_id"), "sources", ["tree_id"], unique=False)

    op.create_table(
        "source_evidence",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("tree_id", sa.String(36), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("filename", sa.String(255), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=True),
        sa.Column("size", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_source_evidence_tree_id"), "source_evidence", ["tree_id"], unique=False
    )
    op.create_index(
        op.f("ix_source_evidence_source_id"),
        "source_evidence",
        ["source_id"],
        unique=False,
    )

    op.create_table(
        "citations",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("tree_id", sa.String(36), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("member_id", sa.String(36), nullable=False),
        sa.Column("fact_type", sa.String(40), nullable=False),
        sa.Column("page", sa.String(255), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_citations_tree_id"), "citations", ["tree_id"], unique=False
    )
    op.create_index(
        op.f("ix_citations_source_id"), "citations", ["source_id"], unique=False
    )
    op.create_index(
        op.f("ix_citations_member_id"), "citations", ["member_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_citations_member_id"), table_name="citations")
    op.drop_index(op.f("ix_citations_source_id"), table_name="citations")
    op.drop_index(op.f("ix_citations_tree_id"), table_name="citations")
    op.drop_table("citations")
    op.drop_index(op.f("ix_source_evidence_source_id"), table_name="source_evidence")
    op.drop_index(op.f("ix_source_evidence_tree_id"), table_name="source_evidence")
    op.drop_table("source_evidence")
    op.drop_index(op.f("ix_sources_tree_id"), table_name="sources")
    op.drop_table("sources")
