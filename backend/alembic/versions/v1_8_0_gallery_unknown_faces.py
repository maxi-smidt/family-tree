"""Add gallery_unknown_faces (unknown-person face tags -> research tasks).

Revision ID: v1_8_0_gallery_unknown_faces
Revises: v1_8_0_research_task_links
Create Date: 2026-07-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v1_8_0_gallery_unknown_faces"
down_revision: Union[str, None] = "v1_8_0_research_task_links"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "gallery_unknown_faces",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("gallery_image_id", sa.String(length=36), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=True),
        sa.ForeignKeyConstraint(
            ["gallery_image_id"], ["gallery_images.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["member_tasks.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_gallery_unknown_faces_gallery_image_id"),
        "gallery_unknown_faces",
        ["gallery_image_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_gallery_unknown_faces_gallery_image_id"),
        table_name="gallery_unknown_faces",
    )
    op.drop_table("gallery_unknown_faces")
