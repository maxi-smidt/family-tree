"""tree_invitations table and public_role on trees

Revision ID: c1d2e3f4a5b6
Revises: b3e9f1a2c4d7
Create Date: 2026-06-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"
down_revision: str | None = "b3e9f1a2c4d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trees", sa.Column("public_role", sa.String(20), nullable=True))

    op.create_table(
        "tree_invitations",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("tree_id", sa.String(36), nullable=False),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("role", sa.String(20), nullable=False, server_default="editor"),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=True),
        sa.Column("accepted_at", sa.String(40), nullable=True),
        sa.Column("accepted_by", sa.String(36), nullable=True),
        sa.Column("revoked_at", sa.String(40), nullable=True),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["accepted_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tree_invitations_tree_id", "tree_invitations", ["tree_id"])
    op.create_index("ix_tree_invitations_token", "tree_invitations", ["token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_tree_invitations_token", table_name="tree_invitations")
    op.drop_index("ix_tree_invitations_tree_id", table_name="tree_invitations")
    op.drop_table("tree_invitations")
    op.drop_column("trees", "public_role")
