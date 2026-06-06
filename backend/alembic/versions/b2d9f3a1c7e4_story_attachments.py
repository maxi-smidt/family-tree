"""story attachments + optional story content

Revision ID: b2d9f3a1c7e4
Revises: 319ad732bdf2
Create Date: 2026-06-06 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2d9f3a1c7e4'
down_revision: Union[str, None] = '319ad732bdf2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Stories may now carry only attachments and no narrative text.
    op.alter_column('stories', 'content', existing_type=sa.Text(), nullable=True)

    op.create_table(
        'story_attachments',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('story_id', sa.String(length=36), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.String(length=100), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['story_id'], ['stories.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('story_attachments', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_story_attachments_tree_id'), ['tree_id'], unique=False
        )
        batch_op.create_index(
            batch_op.f('ix_story_attachments_story_id'), ['story_id'], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table('story_attachments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_story_attachments_story_id'))
        batch_op.drop_index(batch_op.f('ix_story_attachments_tree_id'))
    op.drop_table('story_attachments')

    op.alter_column('stories', 'content', existing_type=sa.Text(), nullable=False)
