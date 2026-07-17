"""Add self-managed account profile fields and private profile image storage.

Revision ID: v1_8_0_user_profiles
Revises: v1_8_0_gallery_face_tags
Create Date: 2026-07-14 22:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v1_8_0_user_profiles"
down_revision: Union[str, None] = "v1_8_0_gallery_face_tags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("first_name", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("last_name", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("profile_image", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "profile_image")
    op.drop_column("users", "last_name")
    op.drop_column("users", "first_name")
