"""enforce pending identity-link-claim pair uniqueness (#1014)

Revision ID: 4c8b74c22044
Revises: a540ee9c5722
Create Date: 2026-09-06 13:35:58.731565

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4c8b74c22044'
down_revision: Union[str, None] = 'a540ee9c5722'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'uq_identity_link_claim_pending',
        'identity_link_claims',
        ['source_member_id', 'target_user_id'],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    # NOTE: autogenerate also proposed dropping members.linked_member_id /
    # linked_workspace_id (and their index/FKs) and recreating
    # ix_members_name_normalized_trgm. Both are pre-existing drift between
    # this dev DB and the ORM models, unrelated to #1014 — left for a
    # separate migration (see a540ee9c5722's note).


def downgrade() -> None:
    op.drop_index(
        'uq_identity_link_claim_pending',
        table_name='identity_link_claims',
        postgresql_where=sa.text("status = 'pending'"),
    )
