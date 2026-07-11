"""Add an indexed document-file media lookup.

Revision ID: 20260711_document_file_media_lookup_index
Revises: 20260711_story_timeline_date
Create Date: 2026-07-11 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260711_document_file_media_lookup_index"
down_revision: str | None = "20260711_story_timeline_date"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_document_files_tree_id_url",
        "document_files",
        ["tree_id", "url"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_document_files_tree_id_url", table_name="document_files")
