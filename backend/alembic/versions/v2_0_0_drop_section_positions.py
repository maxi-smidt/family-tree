"""v2.0.0 drop per-section layout positions

Sections show members at their workspace positions; the per-section layout
overlay was never read or written by the app, and a saved view filtered to a
section already covers a section-specific arrangement.

Revision ID: v2_0_0_drop_section_positions
Revises: v2_0_0_share_access_levels
Create Date: 2026-10-17 17:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "v2_0_0_drop_section_positions"
down_revision: Union[str, None] = "v2_0_0_share_access_levels"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("section_positions")


def downgrade() -> None:
    op.create_table(
        "section_positions",
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("section_id", "member_id"),
    )
