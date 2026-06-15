"""virtual view nested sources

Allow a virtual view source to be another virtual view (recursive composition).
A source row now references a tree OR a view; the primary key moves from
``(view_id, tree_id)`` to ``(view_id, position)`` and a check constraint enforces
that exactly one of ``tree_id`` / ``source_view_id`` is set.

Revision ID: a1b2c3d4e5f6
Revises: c7d8e9f0a1b2
Create Date: 2026-06-15

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # New "source is another virtual view" FK column.
    op.add_column(
        "virtual_view_sources",
        sa.Column("source_view_id", sa.String(length=40), nullable=True),
    )
    op.create_foreign_key(
        "fk_vvs_source_view_id",
        "virtual_view_sources",
        "virtual_views",
        ["source_view_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # A source is now a tree OR a view: drop the old PK, make tree_id nullable,
    # and rebuild the PK on (view_id, position) — positions are unique per view.
    op.drop_constraint(
        "virtual_view_sources_pkey", "virtual_view_sources", type_="primary"
    )
    op.alter_column(
        "virtual_view_sources",
        "tree_id",
        existing_type=sa.String(length=36),
        nullable=True,
    )
    op.create_primary_key(
        "virtual_view_sources_pkey",
        "virtual_view_sources",
        ["view_id", "position"],
    )
    op.create_check_constraint(
        "ck_vvs_exactly_one_source",
        "virtual_view_sources",
        "(tree_id IS NULL) <> (source_view_id IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_vvs_exactly_one_source", "virtual_view_sources", type_="check"
    )
    op.drop_constraint(
        "virtual_view_sources_pkey", "virtual_view_sources", type_="primary"
    )
    op.drop_constraint(
        "fk_vvs_source_view_id", "virtual_view_sources", type_="foreignkey"
    )
    # View-sourced rows cannot be represented once tree_id is required again.
    op.execute("DELETE FROM virtual_view_sources WHERE tree_id IS NULL")
    op.alter_column(
        "virtual_view_sources",
        "tree_id",
        existing_type=sa.String(length=36),
        nullable=False,
    )
    op.create_primary_key(
        "virtual_view_sources_pkey",
        "virtual_view_sources",
        ["view_id", "tree_id"],
    )
    op.drop_column("virtual_view_sources", "source_view_id")
