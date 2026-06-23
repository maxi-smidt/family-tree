"""add label and edge style to relation types

Adds admin-configurable label plus per-type edge styling (color, stroke width
and dash pattern) to the relation_types registry. All columns are nullable with
no server default, so existing rows (including the seeded built-in types) keep
NULL and the application falls back to the hardcoded worker defaults.

Revision ID: v1_1_0_relation_type_style
Revises: v1_0_0_baseline
Create Date: 2026-06-23 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_1_0_relation_type_style'
down_revision: Union[str, None] = 'v1_0_0_baseline'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'relation_types', sa.Column('label', sa.String(length=255), nullable=True)
    )
    op.add_column(
        'relation_types', sa.Column('color', sa.String(length=64), nullable=True)
    )
    op.add_column(
        'relation_types', sa.Column('stroke_width', sa.Float(), nullable=True)
    )
    op.add_column(
        'relation_types',
        sa.Column('stroke_dasharray', sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('relation_types', 'stroke_dasharray')
    op.drop_column('relation_types', 'stroke_width')
    op.drop_column('relation_types', 'color')
    op.drop_column('relation_types', 'label')
