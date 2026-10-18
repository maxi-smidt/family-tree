"""v2.2.0 document file texts

Adds ``document_file_texts``: the editable Markdown text of one uploaded
document file, in the file's original language (#1121). It lives in its own
table so document lists never carry the text.

Revision ID: v2_2_0_document_file_texts
Revises: v2_1_0_drop_v1_migration_state
Create Date: 2026-10-18 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "v2_2_0_document_file_texts"
down_revision: Union[str, None] = "v2_1_0_drop_v1_migration_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_file_texts",
        sa.Column("document_file_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("language", sa.String(length=16), nullable=True),
        sa.Column("markdown", sa.Text(), nullable=False),
        sa.Column("machine_markdown", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("provider", sa.String(length=100), nullable=True),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("edited_by", sa.String(length=36), nullable=True),
        sa.Column("edited_at", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_file_id"], ["document_files.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("document_file_id"),
    )
    op.create_index(
        "ix_document_file_texts_workspace_id",
        "document_file_texts",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_document_file_texts_workspace_id", table_name="document_file_texts")
    op.drop_table("document_file_texts")
