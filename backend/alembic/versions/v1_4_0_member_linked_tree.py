"""v1.4.0 — add members.linked_tree_id (tree-in-tree link)

Revision ID: v1_4_0_member_linked_tree
Revises: v1_4_0_legal_quality_cemetery
Create Date: 2026-06-27 12:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_4_0_member_linked_tree'
down_revision: Union[str, None] = 'v1_4_0_legal_quality_cemetery'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Optional pointer from a member to another tree detailing that person's
    # own family. SET NULL on delete so removing the target tree just clears
    # the link. Named FK + index so the constraint can be dropped on downgrade.
    op.add_column(
        'members',
        sa.Column('linked_tree_id', sa.String(length=36), nullable=True),
    )
    op.create_index(
        op.f('ix_members_linked_tree_id'),
        'members',
        ['linked_tree_id'],
    )
    op.create_foreign_key(
        'fk_members_linked_tree_id_trees',
        'members',
        'trees',
        ['linked_tree_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_members_linked_tree_id_trees', 'members', type_='foreignkey')
    op.drop_index(op.f('ix_members_linked_tree_id'), table_name='members')
    op.drop_column('members', 'linked_tree_id')
