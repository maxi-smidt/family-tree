"""Add the document_uploads staging table.

Streamed document files land here first (bytes already on disk) and are then
attached to a document as one atomic save, so a failed edit never destroys the
previous version and unclaimed uploads can be reaped.

Revision ID: v1_7_1_document_uploads
Revises: v1_7_0_release
Create Date: 2026-07-12 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_7_1_document_uploads'
down_revision: Union[str, None] = 'v1_7_0_release'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_uploads",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "tree_id",
            sa.String(length=36),
            sa.ForeignKey("trees.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=True),
        sa.Column("size", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
    )
    op.create_index(
        "ix_document_uploads_tree_id", "document_uploads", ["tree_id"]
    )
    op.create_index(
        "ix_document_uploads_created_at", "document_uploads", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_document_uploads_created_at", table_name="document_uploads")
    op.drop_index("ix_document_uploads_tree_id", table_name="document_uploads")
    op.drop_table("document_uploads")
