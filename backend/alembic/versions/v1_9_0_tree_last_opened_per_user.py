"""v1.9.0 per-user tree/view last-opened state

Fixes #878: ``trees.last_opened`` and ``virtual_views.last_opened`` were a
single value shared by every collaborator, so one viewer opening a shared
tree (or an admin opening someone else's virtual view) reordered every other
collaborator's recent list. Replaces both columns with per-(resource, user)
state tables (``tree_user_states`` / ``virtual_view_user_states``). Existing
values are migrated to a row for the resource's current owner — the best
available approximation, since the old column never recorded who caused the
last open.

Revision ID: v1_9_0_tree_last_opened_per_user
Revises: v1_9_0_restore_markers
Create Date: 2026-08-21 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "v1_9_0_tree_last_opened_per_user"
down_revision: Union[str, None] = "v1_9_0_restore_markers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tree_user_states",
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("last_opened", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tree_id", "user_id"),
    )
    op.create_table(
        "virtual_view_user_states",
        sa.Column("view_id", sa.String(length=40), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("last_opened", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(
            ["view_id"], ["virtual_views.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("view_id", "user_id"),
    )

    # Seed each resource's owner with its previous (global) last_opened value
    # so existing "recently opened" ordering survives the migration.
    op.execute(
        "INSERT INTO tree_user_states (tree_id, user_id, last_opened) "
        "SELECT id, owner_id, last_opened FROM trees WHERE last_opened IS NOT NULL"
    )
    op.execute(
        "INSERT INTO virtual_view_user_states (view_id, user_id, last_opened) "
        "SELECT id, owner_id, last_opened FROM virtual_views "
        "WHERE last_opened IS NOT NULL"
    )

    op.drop_column("trees", "last_opened")
    op.drop_column("virtual_views", "last_opened")


def downgrade() -> None:
    op.add_column(
        "trees", sa.Column("last_opened", sa.String(length=40), nullable=True)
    )
    op.add_column(
        "virtual_views", sa.Column("last_opened", sa.String(length=40), nullable=True)
    )

    # Best-effort reverse: collapse each resource's per-user stamps back to a
    # single value (the most recent one across all its users).
    op.execute(
        "UPDATE trees SET last_opened = ("
        "  SELECT MAX(last_opened) FROM tree_user_states"
        "  WHERE tree_user_states.tree_id = trees.id"
        ")"
    )
    op.execute(
        "UPDATE virtual_views SET last_opened = ("
        "  SELECT MAX(last_opened) FROM virtual_view_user_states"
        "  WHERE virtual_view_user_states.view_id = virtual_views.id"
        ")"
    )

    op.drop_table("virtual_view_user_states")
    op.drop_table("tree_user_states")
