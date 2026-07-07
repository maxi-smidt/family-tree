"""v1.7.0 — Documents (replaces Sources/Citations/Evidence + story attachments)

Revision ID: v1_7_0_documents
Revises: v1_5_0_linked_tree_geocode
Create Date: 2026-07-07 12:00:00.000000

"""
from datetime import datetime, timezone
from typing import Sequence, Union
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_7_0_documents'
down_revision: Union[str, None] = 'v1_5_0_linked_tree_geocode'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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

    # --- Data migration: story_attachments -> one Document per story ----------
    bind = op.get_bind()

    stories_t = sa.table(
        'stories',
        sa.column('id', sa.String),
        sa.column('tree_id', sa.String),
        sa.column('title', sa.String),
    )
    story_attachments_t = sa.table(
        'story_attachments',
        sa.column('id', sa.String),
        sa.column('tree_id', sa.String),
        sa.column('story_id', sa.String),
        sa.column('filename', sa.String),
        sa.column('url', sa.Text),
        sa.column('mime_type', sa.String),
        sa.column('size', sa.Integer),
        sa.column('created_at', sa.String),
    )
    story_member_link_t = sa.table(
        'story_member_link',
        sa.column('story_id', sa.String),
        sa.column('member_id', sa.String),
    )
    documents_t = sa.table(
        'documents',
        sa.column('id', sa.String),
        sa.column('tree_id', sa.String),
        sa.column('title', sa.String),
        sa.column('document_date', sa.String),
        sa.column('description', sa.Text),
        sa.column('created_at', sa.String),
        sa.column('updated_at', sa.String),
    )
    document_files_t = sa.table(
        'document_files',
        sa.column('id', sa.String),
        sa.column('tree_id', sa.String),
        sa.column('document_id', sa.String),
        sa.column('kind', sa.String),
        sa.column('filename', sa.String),
        sa.column('url', sa.Text),
        sa.column('mime_type', sa.String),
        sa.column('size', sa.Integer),
        sa.column('created_at', sa.String),
    )
    document_member_link_t = sa.table(
        'document_member_link',
        sa.column('document_id', sa.String),
        sa.column('member_id', sa.String),
    )
    story_document_link_t = sa.table(
        'story_document_link',
        sa.column('story_id', sa.String),
        sa.column('document_id', sa.String),
    )

    story_ids_with_attachments = [
        row.story_id
        for row in bind.execute(
            sa.select(story_attachments_t.c.story_id).distinct()
        ).fetchall()
    ]

    for story_id in story_ids_with_attachments:
        story_row = bind.execute(
            sa.select(stories_t.c.id, stories_t.c.tree_id, stories_t.c.title).where(
                stories_t.c.id == story_id
            )
        ).first()
        if story_row is None:
            continue  # defensive: orphaned attachment row, nothing to migrate onto

        now = _now_iso()
        document_id = str(uuid4())
        bind.execute(
            documents_t.insert().values(
                id=document_id,
                tree_id=story_row.tree_id,
                title=(story_row.title or "").strip() or "Attachments",
                document_date=None,
                description=None,
                created_at=now,
                updated_at=now,
            )
        )

        attachment_rows = bind.execute(
            sa.select(
                story_attachments_t.c.id,
                story_attachments_t.c.filename,
                story_attachments_t.c.url,
                story_attachments_t.c.mime_type,
                story_attachments_t.c.size,
                story_attachments_t.c.created_at,
            ).where(story_attachments_t.c.story_id == story_id)
        ).fetchall()
        for att in attachment_rows:
            bind.execute(
                document_files_t.insert().values(
                    id=str(uuid4()),
                    tree_id=story_row.tree_id,
                    document_id=document_id,
                    kind='file',
                    filename=att.filename,
                    url=att.url,
                    mime_type=att.mime_type,
                    size=att.size,
                    created_at=att.created_at,
                )
            )

        member_rows = bind.execute(
            sa.select(story_member_link_t.c.member_id).where(
                story_member_link_t.c.story_id == story_id
            )
        ).fetchall()
        for m in member_rows:
            bind.execute(
                document_member_link_t.insert().values(
                    document_id=document_id, member_id=m.member_id
                )
            )

        bind.execute(
            story_document_link_t.insert().values(
                story_id=story_id, document_id=document_id
            )
        )

    # --- Drop the superseded tables --------------------------------------------
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
