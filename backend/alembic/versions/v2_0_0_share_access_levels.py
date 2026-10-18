"""v2.0.0 per-area share access levels

#1101: a share now carries a level per area (Hidden, View, Edit) instead of
one role plus hide toggles. Adds ``read_only`` (areas an editor grant may see
but not change) to workspace memberships and section grants, and folds the
legacy toggles into the new areas: "map" follows events, "biography" follows
stories, and "tree" (never enforced, and no longer hideable) is dropped.

Revision ID: v2_0_0_share_access_levels
Revises: v2_0_0_workspaces
Create Date: 2026-10-17 15:30:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "v2_0_0_share_access_levels"
down_revision: Union[str, None] = "v2_0_0_workspaces"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ALIASES = {"map": "events", "biography": "stories", "tree": None}
_HIDEABLE = {"gallery", "sources", "stories", "events", "diseases", "tasks"}


def _normalize(value):
    if value is None:
        return None
    domains = json.loads(value) if isinstance(value, str) else value
    result = set()
    for domain in domains or ():
        area = _ALIASES.get(domain, domain)
        if area in _HIDEABLE:
            result.add(area)
    return sorted(result) or None


def migrate_restrictions(bind, table: str, key_columns: tuple[str, ...]) -> None:
    meta = sa.MetaData()
    t = sa.Table(table, meta, autoload_with=bind)
    rows = bind.execute(
        sa.select(*(t.c[k] for k in key_columns), t.c.restrictions).where(
            t.c.restrictions.isnot(None)
        )
    ).all()
    for row in rows:
        before = row.restrictions
        after = _normalize(before)
        before_list = json.loads(before) if isinstance(before, str) else before
        if after == (sorted(before_list) if before_list else None):
            continue
        bind.execute(
            t.update()
            .where(*(t.c[k] == getattr(row, k) for k in key_columns))
            .values(restrictions=after)
        )


def upgrade() -> None:
    op.add_column(
        "workspace_memberships", sa.Column("read_only", sa.JSON(), nullable=True)
    )
    op.add_column(
        "workspace_section_grants", sa.Column("read_only", sa.JSON(), nullable=True)
    )
    bind = op.get_bind()
    migrate_restrictions(bind, "workspace_memberships", ("workspace_id", "user_id"))
    migrate_restrictions(bind, "workspace_section_grants", ("id",))


def downgrade() -> None:
    # Folded legacy keys ("map", "biography", "tree") are not restored.
    op.drop_column("workspace_section_grants", "read_only")
    op.drop_column("workspace_memberships", "read_only")
