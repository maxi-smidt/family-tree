"""Add an optional historical date to stories.

Revision ID: 20260711_story_timeline_date
Revises: 20260710_public_access_version
Create Date: 2026-07-11 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260711_story_timeline_date"
down_revision: Union[str, None] = "20260710_public_access_version"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("stories", sa.Column("date", sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column("stories", "date")
