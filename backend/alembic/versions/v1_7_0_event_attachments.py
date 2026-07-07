"""v1.7.0 — event attachments

Revision ID: v1_7_0_event_attachments
Revises: v1_5_0_linked_tree_geocode
Create Date: 2026-07-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_7_0_event_attachments'
down_revision: Union[str, None] = 'v1_5_0_linked_tree_geocode'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # File attachments on events — mirrors story_attachments so events get the
    # same direct document/image upload workflow as stories.
    op.create_table('event_attachments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('tree_id', sa.String(length=36), nullable=False),
    sa.Column('event_id', sa.String(length=36), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('url', sa.Text(), nullable=False),
    sa.Column('mime_type', sa.String(length=100), nullable=True),
    sa.Column('size', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.String(length=40), nullable=False),
    sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_event_attachments_event_id'), 'event_attachments', ['event_id'], unique=False)
    op.create_index(op.f('ix_event_attachments_tree_id'), 'event_attachments', ['tree_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_event_attachments_tree_id'), table_name='event_attachments')
    op.drop_index(op.f('ix_event_attachments_event_id'), table_name='event_attachments')
    op.drop_table('event_attachments')
