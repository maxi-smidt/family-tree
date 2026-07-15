"""Add normalized face regions to gallery-member links.

Revision ID: v1_8_0_gallery_face_tags
Revises: v1_7_0_release
Create Date: 2026-07-14 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v1_8_0_gallery_face_tags"
down_revision: Union[str, None] = "v1_7_0_release"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "gallery_member_link", sa.Column("x", sa.Float(), nullable=True)
    )
    op.add_column(
        "gallery_member_link", sa.Column("y", sa.Float(), nullable=True)
    )
    op.add_column(
        "gallery_member_link", sa.Column("w", sa.Float(), nullable=True)
    )
    op.add_column(
        "gallery_member_link", sa.Column("h", sa.Float(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("gallery_member_link", "h")
    op.drop_column("gallery_member_link", "w")
    op.drop_column("gallery_member_link", "y")
    op.drop_column("gallery_member_link", "x")
