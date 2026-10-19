"""v2.2.0 member field citations

Adds ``member_field_citations``: a document cited as evidence for one field of
a person (names, birth and death dates, birthplace), optionally narrowed to
one file, a page and a quoted passage of that file's text.

Revision ID: v2_2_0_member_field_citations
Revises: v2_2_0_ai_transcription
Create Date: 2026-10-18 21:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "v2_2_0_member_field_citations"
down_revision: Union[str, None] = "v2_2_0_ai_transcription"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "member_field_citations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.Column("field", sa.String(length=32), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("document_file_id", sa.String(length=36), nullable=True),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("quote", sa.Text(), nullable=True),
        sa.Column("quote_prefix", sa.String(length=200), nullable=True),
        sa.Column("quote_suffix", sa.String(length=200), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["document_file_id"], ["document_files.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_member_field_citations_workspace_id",
        "member_field_citations",
        ["workspace_id"],
    )
    op.create_index(
        "ix_member_field_citations_member_id_field",
        "member_field_citations",
        ["member_id", "field"],
    )
    op.create_index(
        "ix_member_field_citations_document_id",
        "member_field_citations",
        ["document_id"],
    )
    op.create_index(
        "ix_member_field_citations_document_file_id",
        "member_field_citations",
        ["document_file_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_member_field_citations_document_file_id",
        table_name="member_field_citations",
    )
    op.drop_index(
        "ix_member_field_citations_document_id", table_name="member_field_citations"
    )
    op.drop_index(
        "ix_member_field_citations_member_id_field", table_name="member_field_citations"
    )
    op.drop_index(
        "ix_member_field_citations_workspace_id", table_name="member_field_citations"
    )
    op.drop_table("member_field_citations")
