"""v2.2.0 AI transcription

Adds ``user_ai_settings`` (each person's own AI provider, model and sealed API
key) and ``document_file_transcriptions`` (the latest AI run per document
file, with its status) for AI transcription of document files (#1123).

Revision ID: v2_2_0_ai_transcription
Revises: v2_2_0_document_text_search
Create Date: 2026-10-18 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "v2_2_0_ai_transcription"
down_revision: Union[str, None] = "v2_2_0_document_text_search"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_ai_settings",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=True),
        sa.Column("api_key_sealed", sa.Text(), nullable=True),
        sa.Column("api_key_hint", sa.String(length=8), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "document_file_transcriptions",
        sa.Column("document_file_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("requested_by", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_file_id"], ["document_files.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("document_file_id"),
    )
    op.create_index(
        "ix_document_file_transcriptions_workspace_id",
        "document_file_transcriptions",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_document_file_transcriptions_workspace_id",
        table_name="document_file_transcriptions",
    )
    op.drop_table("document_file_transcriptions")
    op.drop_table("user_ai_settings")
