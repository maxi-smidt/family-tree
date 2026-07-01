"""v1.4.0 — legal documents, quality-issue dismissals, cemetery field

Squashes the individual migrations cut between v1.3.1 and v1.4.0 into a single
release migration:

  * legal acceptances + immutable document versions, per-locale (#519, #532)
  * quality-issue dismissals table (#531)
  * cemetery / place-of-burial column on members (#533)

This collapses the intermediate legal-document index/constraint rework into the
net final schema. Production databases sit at ``v1_3_0_adopted_drop_horizontal``
(the last released migration) and apply this directly; dev databases stamped at
one of the now-removed intermediate revisions are purged to the baseline and
rebuilt by ``app.db.init_db``.

Revision ID: v1_4_0_legal_quality_cemetery
Revises: v1_3_0_adopted_drop_horizontal
Create Date: 2026-07-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_4_0_legal_quality_cemetery'
down_revision: Union[str, None] = 'v1_3_0_adopted_drop_horizontal'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Legal acceptances (append-only consent log) -----------------------
    op.create_table(
        'legal_acceptances',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=True),
        sa.Column('username', sa.String(length=150), nullable=False),
        sa.Column('version', sa.String(length=50), nullable=False),
        sa.Column('accepted_at', sa.String(length=40), nullable=False),
        sa.Column('ip_address', sa.String(length=64), nullable=True),
        sa.Column('user_agent', sa.String(length=512), nullable=True),
        sa.Column('terms_hash', sa.String(length=64), nullable=True),
        sa.Column('privacy_hash', sa.String(length=64), nullable=True),
        sa.Column('locale', sa.String(length=8), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_legal_acceptances_user_id', 'legal_acceptances', ['user_id'], unique=False
    )

    # --- Immutable legal document versions ---------------------------------
    op.create_table(
        'legal_document_versions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('document_type', sa.String(length=20), nullable=False),
        sa.Column('version', sa.String(length=50), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('content_hash', sa.String(length=64), nullable=False),
        sa.Column('published_at', sa.String(length=40), nullable=False),
        sa.Column('locale', sa.String(length=8), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'document_type',
            'locale',
            'content_hash',
            name='uq_legal_doc_version_type_locale_hash',
        ),
    )
    op.create_index(
        'ix_legal_doc_versions_type_locale_version',
        'legal_document_versions',
        ['document_type', 'locale', 'version'],
        unique=False,
    )

    # --- Quality-issue dismissals ------------------------------------------
    op.create_table(
        'quality_issue_dismissals',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('issue_id', sa.String(length=64), nullable=False),
        sa.Column('issue_type', sa.String(length=50), nullable=False),
        sa.Column('member_ids', sa.Text(), nullable=False),
        sa.Column('dismissed_at', sa.String(length=40), nullable=False),
        sa.Column('dismissed_by_id', sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(['dismissed_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tree_id', 'issue_id', name='uq_quality_dismissal_tree_issue'),
    )
    op.create_index(
        op.f('ix_quality_issue_dismissals_issue_id'),
        'quality_issue_dismissals',
        ['issue_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_quality_issue_dismissals_tree_id'),
        'quality_issue_dismissals',
        ['tree_id'],
        unique=False,
    )

    # --- Cemetery / place of burial ----------------------------------------
    op.add_column('members', sa.Column('cemetery', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('members', 'cemetery')

    op.drop_index(
        op.f('ix_quality_issue_dismissals_tree_id'),
        table_name='quality_issue_dismissals',
    )
    op.drop_index(
        op.f('ix_quality_issue_dismissals_issue_id'),
        table_name='quality_issue_dismissals',
    )
    op.drop_table('quality_issue_dismissals')

    op.drop_index(
        'ix_legal_doc_versions_type_locale_version',
        table_name='legal_document_versions',
    )
    op.drop_table('legal_document_versions')

    op.drop_index('ix_legal_acceptances_user_id', table_name='legal_acceptances')
    op.drop_table('legal_acceptances')
