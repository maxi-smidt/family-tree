"""Convert per-tree relation types into a single instance-wide registry.

The old ``relation_types`` table held one copy of the types per tree; the new
table is global (admin-managed). The distinct union of all per-tree types is
preserved so every type referenced by existing relations stays available.

Revision ID: a7c4e9d12b38
Revises: f8c1d2e3a4b5
Create Date: 2026-06-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c4e9d12b38'
down_revision: Union[str, None] = 'f8c1d2e3a4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'relation_types_global',
        sa.Column('id', sa.String(length=50), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute(
        'INSERT INTO relation_types_global (id, description) '
        'SELECT id, MAX(description) FROM relation_types GROUP BY id'
    )
    op.drop_table('relation_types')
    op.rename_table('relation_types_global', 'relation_types')
    op.execute('ALTER INDEX relation_types_global_pkey RENAME TO relation_types_pkey')


def downgrade() -> None:
    # Re-create the per-tree table by giving every tree a copy of the registry.
    op.execute('ALTER INDEX relation_types_pkey RENAME TO relation_types_global_pkey')
    op.rename_table('relation_types', 'relation_types_global')
    op.create_table(
        'relation_types',
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('id', sa.String(length=50), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('tree_id', 'id'),
    )
    op.execute(
        'INSERT INTO relation_types (tree_id, id, description) '
        'SELECT t.id, g.id, g.description FROM trees t CROSS JOIN relation_types_global g'
    )
    op.drop_table('relation_types_global')
