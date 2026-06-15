"""friendships table + backfill from existing tree memberships

Revision ID: b8d3f4a1c2e9
Revises: ebaa6c6b4f47
Create Date: 2026-06-15 00:00:00.000000

"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8d3f4a1c2e9"
down_revision: str | None = "ebaa6c6b4f47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "friendships",
        sa.Column("requester_id", sa.String(36), nullable=False),
        sa.Column("addressee_id", sa.String(36), nullable=False),
        sa.Column(
            "status", sa.String(20), nullable=False, server_default="pending"
        ),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("responded_at", sa.String(40), nullable=True),
        sa.ForeignKeyConstraint(["requester_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["addressee_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("requester_id", "addressee_id"),
    )
    op.create_index("ix_friendships_requester_id", "friendships", ["requester_id"])
    op.create_index("ix_friendships_addressee_id", "friendships", ["addressee_id"])

    # Backfill: sharing is now friendship-gated, so make every existing
    # owner/member pair accepted friends. This preserves current shares (and the
    # role-change path, which reuses the share boundary). One row per unordered
    # pair; self-ownership edges are skipped.
    conn = op.get_bind()
    pairs = conn.execute(
        sa.text(
            "SELECT DISTINCT t.owner_id AS owner_id, m.user_id AS member_id "
            "FROM tree_memberships m JOIN trees t ON t.id = m.tree_id "
            "WHERE t.owner_id <> m.user_id"
        )
    ).fetchall()
    now = datetime.now(UTC).isoformat()
    seen: set[frozenset[str]] = set()
    insert = sa.text(
        "INSERT INTO friendships "
        "(requester_id, addressee_id, status, created_at, responded_at) "
        "VALUES (:requester, :addressee, 'accepted', :now, :now)"
    )
    for owner_id, member_id in pairs:
        key = frozenset((owner_id, member_id))
        if key in seen:
            continue
        seen.add(key)
        conn.execute(
            insert, {"requester": owner_id, "addressee": member_id, "now": now}
        )


def downgrade() -> None:
    op.drop_index("ix_friendships_addressee_id", table_name="friendships")
    op.drop_index("ix_friendships_requester_id", table_name="friendships")
    op.drop_table("friendships")
