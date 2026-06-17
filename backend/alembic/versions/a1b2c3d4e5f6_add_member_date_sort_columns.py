"""add member date sort columns

Adds ``dateOfBirthSort`` and ``dateOfDeathSort`` to the ``members`` table.
These are derived, indexed, zero-padded ``YYYY-MM-DD`` strings that enable
reliable lexicographic ordering of fuzzy genealogy dates without changing the
original display value.

Both columns are backfilled for existing rows using the pure
``app.services.genealogy_date.sort_key`` helper so the upgrade is self-
contained and idempotent.

Revision ID: a1b2c3d4e5f6
Revises: f8c1d2e3a4b5
Create Date: 2026-06-17

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f8c1d2e3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add the two new columns (nullable, no server default needed).
    op.add_column(
        "members",
        sa.Column("dateOfBirthSort", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "members",
        sa.Column("dateOfDeathSort", sa.String(length=10), nullable=True),
    )

    # 2. Create indexes for efficient date-range queries and sorting.
    op.create_index(
        "ix_members_dateOfBirthSort", "members", ["dateOfBirthSort"], unique=False
    )
    op.create_index(
        "ix_members_dateOfDeathSort", "members", ["dateOfDeathSort"], unique=False
    )

    # 3. Backfill existing rows.
    #    Use a lightweight table reflection so we avoid importing ORM models
    #    (which would pull in relationships not yet materialised at migration time).
    from app.services.genealogy_date import sort_key  # noqa: PLC0415

    bind = op.get_bind()
    members_table = sa.table(
        "members",
        sa.column("id", sa.String),
        sa.column("dateOfBirth", sa.String),
        sa.column("dateOfDeath", sa.String),
        sa.column("dateOfBirthSort", sa.String),
        sa.column("dateOfDeathSort", sa.String),
    )

    rows = bind.execute(
        sa.select(
            members_table.c.id,
            members_table.c.dateOfBirth,
            members_table.c.dateOfDeath,
        )
    ).fetchall()

    for row in rows:
        birth_sort = sort_key(row.dateOfBirth)
        death_sort = sort_key(row.dateOfDeath)
        bind.execute(
            sa.update(members_table)
            .where(members_table.c.id == row.id)
            .values(dateOfBirthSort=birth_sort, dateOfDeathSort=death_sort)
        )


def downgrade() -> None:
    op.drop_index("ix_members_dateOfDeathSort", table_name="members")
    op.drop_index("ix_members_dateOfBirthSort", table_name="members")
    op.drop_column("members", "dateOfDeathSort")
    op.drop_column("members", "dateOfBirthSort")
