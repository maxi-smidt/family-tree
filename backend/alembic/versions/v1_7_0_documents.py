"""v1.7.0 — Documents (replaces Sources/Citations/Evidence + story attachments)

Revision ID: v1_7_0_documents
Revises: v1_5_0_linked_tree_geocode
Create Date: 2026-07-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_7_0_documents'
down_revision: Union[str, None] = 'v1_5_0_linked_tree_geocode'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- New tables -----------------------------------------------------------
    op.create_table(
        'documents',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('document_date', sa.String(length=40), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.Column('updated_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_documents_tree_id'), 'documents', ['tree_id'], unique=False
    )

    op.create_table(
        'document_files',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=True),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.String(length=100), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_document_files_document_id'), 'document_files', ['document_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_document_files_tree_id'), 'document_files', ['tree_id'], unique=False
    )

    op.create_table(
        'document_member_link',
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.Column('member_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['member_id'], ['members.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('document_id', 'member_id'),
    )

    op.create_table(
        'event_document_link',
        sa.Column('event_id', sa.String(length=36), nullable=False),
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('event_id', 'document_id'),
    )

    op.create_table(
        'story_document_link',
        sa.Column('story_id', sa.String(length=36), nullable=False),
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['story_id'], ['stories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('story_id', 'document_id'),
    )

    # --- Drop the superseded tables --------------------------------------------
    # The old story attachments and Sources/Citations/Evidence data is dropped
    # outright — it is not migrated into the new Documents model.
    op.drop_table('story_attachments')

    # FK-safe order: citations and source_evidence reference sources.
    op.drop_index(op.f('ix_citations_tree_id'), table_name='citations')
    op.drop_index(op.f('ix_citations_source_id'), table_name='citations')
    op.drop_index(op.f('ix_citations_member_id'), table_name='citations')
    op.drop_table('citations')

    op.drop_index(op.f('ix_source_evidence_tree_id'), table_name='source_evidence')
    op.drop_index(op.f('ix_source_evidence_source_id'), table_name='source_evidence')
    op.drop_table('source_evidence')

    op.drop_index(op.f('ix_sources_tree_id'), table_name='sources')
    op.drop_table('sources')


def downgrade() -> None:
    # No data restoration — this simply recreates the old, empty tables.
    op.create_table(
        'sources',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('author', sa.String(length=255), nullable=True),
        sa.Column('publication_info', sa.Text(), nullable=True),
        sa.Column('repository', sa.String(length=255), nullable=True),
        sa.Column('source_date', sa.String(length=40), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.Column('updated_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_sources_tree_id'), 'sources', ['tree_id'], unique=False)

    op.create_table(
        'source_evidence',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('source_id', sa.String(length=36), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=True),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.String(length=100), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['source_id'], ['sources.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_source_evidence_source_id'), 'source_evidence', ['source_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_source_evidence_tree_id'), 'source_evidence', ['tree_id'],
        unique=False,
    )

    op.create_table(
        'citations',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('source_id', sa.String(length=36), nullable=False),
        sa.Column('member_id', sa.String(length=36), nullable=False),
        sa.Column('fact_type', sa.String(length=40), nullable=False),
        sa.Column('page', sa.String(length=255), nullable=True),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['member_id'], ['members.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_id'], ['sources.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_citations_member_id'), 'citations', ['member_id'], unique=False
    )
    op.create_index(
        op.f('ix_citations_source_id'), 'citations', ['source_id'], unique=False
    )
    op.create_index(
        op.f('ix_citations_tree_id'), 'citations', ['tree_id'], unique=False
    )

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
    op.create_index(
        op.f('ix_story_attachments_story_id'), 'story_attachments', ['story_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_story_attachments_tree_id'), 'story_attachments', ['tree_id'],
        unique=False,
    )

    op.drop_table('story_document_link')
    op.drop_table('event_document_link')
    op.drop_table('document_member_link')

    op.drop_index(op.f('ix_document_files_tree_id'), table_name='document_files')
    op.drop_index(op.f('ix_document_files_document_id'), table_name='document_files')
    op.drop_table('document_files')

    op.drop_index(op.f('ix_documents_tree_id'), table_name='documents')
    op.drop_table('documents')
