"""v1.3.0 — add adopted flag, drop stored horizontal relations

Revision ID: v1_3_0_adopted_drop_horizontal
Revises: v1_1_0_relation_type_style
Create Date: 2026-06-27 08:29:39.170986

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_3_0_adopted_drop_horizontal'
down_revision: Union[str, None] = 'v1_1_0_relation_type_style'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_HORIZONTAL_TYPES = ("sibling", "half-sibling", "step-sibling")


def upgrade() -> None:
    # Part A: delete existing horizontal relation rows and their registry entries,
    # since sibling / half-sibling / step-sibling are now derived from the parent
    # graph rather than stored as explicit rows.
    op.execute(
        "DELETE FROM relations WHERE relation_type IN ('sibling', 'half-sibling', 'step-sibling')"
    )
    op.execute(
        "DELETE FROM relation_types WHERE id IN ('sibling', 'half-sibling', 'step-sibling')"
    )

    # Part B: add the adopted flag to members.
    op.add_column(
        'members',
        sa.Column(
            'adopted',
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column('members', 'adopted')

    # Re-seed the three relation type registry rows.
    op.execute("INSERT INTO relation_types (id) VALUES ('sibling') ON CONFLICT DO NOTHING")
    op.execute("INSERT INTO relation_types (id) VALUES ('half-sibling') ON CONFLICT DO NOTHING")
    op.execute("INSERT INTO relation_types (id) VALUES ('step-sibling') ON CONFLICT DO NOTHING")
    # Note: individual relation rows that were deleted cannot be recovered.
