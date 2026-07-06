"""v1.5.0 — linked tree / member bridge + manual geocode flag

Revision ID: v1_5_0_linked_tree_geocode
Revises: v1_4_0_legal_quality_cemetery
Create Date: 2026-07-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_5_0_linked_tree_geocode'
down_revision: Union[str, None] = 'v1_4_0_legal_quality_cemetery'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Linked tree / member bridge -----------------------------------------
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
    # Member-level identity link: the counterpart row in the linked tree that
    # represents the same person (the "bridge person"). Lets navigation land
    # centered on the counterpart and keeps the two rows associated. SET NULL
    # so deleting the counterpart just degrades the link to tree-level.
    op.add_column(
        'members',
        sa.Column('linked_member_id', sa.String(length=36), nullable=True),
    )
    op.create_index(
        op.f('ix_members_linked_member_id'),
        'members',
        ['linked_member_id'],
    )
    op.create_foreign_key(
        'fk_members_linked_member_id_members',
        'members',
        'members',
        ['linked_member_id'],
        ['id'],
        ondelete='SET NULL',
    )

    # --- Manual geocode flag --------------------------------------------------
    # Marks a geocode_cache row as a user-supplied correction (search pick or
    # manually dropped pin) so the retry/TTL logic never re-geocodes or
    # overwrites it.
    op.add_column(
        'geocode_cache',
        sa.Column(
            'manual', sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column('geocode_cache', 'manual')

    op.drop_constraint(
        'fk_members_linked_member_id_members', 'members', type_='foreignkey'
    )
    op.drop_index(op.f('ix_members_linked_member_id'), table_name='members')
    op.drop_column('members', 'linked_member_id')

    op.drop_constraint(
        'fk_members_linked_tree_id_trees', 'members', type_='foreignkey'
    )
    op.drop_index(op.f('ix_members_linked_tree_id'), table_name='members')
    op.drop_column('members', 'linked_tree_id')
