"""v2.1.0 drop v1 -> v2 migration state

Every deployed instance has finished the v1 -> v2 conversion, so its
bookkeeping and the legacy structures it read are removed: the
``migration_*`` tables (runs, mappings, owner reports, review conflicts,
idempotency keys), the legacy virtual-view tables, the ``members`` bridge
columns, and any notification pointing at a migration report or conflict.

A database that never finished the conversion is refused: dropping the
legacy structures would lose data the converter still needs. Such an
instance has to run v2.0.2 until the conversion completes.

Revision ID: v2_1_0_drop_v1_migration_state
Revises: v2_0_0_share_access_levels
Create Date: 2026-10-17 20:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "v2_1_0_drop_v1_migration_state"
down_revision: Union[str, None] = "v2_0_0_share_access_levels"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Children before the parents they reference.
_MIGRATION_TABLES = (
    "migration_idempotency_keys",
    "migration_conflicts",
    "migration_reports",
    "migration_mappings",
    "migration_runs",
)
_VIRTUAL_VIEW_TABLES = (
    "virtual_view_user_states",
    "virtual_view_sources",
    "virtual_view_member_matches",
    "virtual_view_positions",
    "virtual_views",
)
_MEMBER_BRIDGE_COLUMNS = ("linked_member_id", "linked_workspace_id")
_MIGRATION_NOTIFICATION_TYPES = ("migration_report_ready", "migration_conflict_pending")
_DONE_STATUSES = ("complete", "finalized")


def ensure_conversion_finished(bind) -> None:
    """Raise unless the v1 -> v2 conversion is done (or was never needed)."""
    inspector = sa.inspect(bind)
    if not inspector.has_table("migration_runs"):
        return
    has_workspaces = bind.execute(sa.text("SELECT 1 FROM workspaces LIMIT 1")).first()
    if has_workspaces is None:
        return
    runs = sa.table("migration_runs", sa.column("status"))
    done = bind.execute(
        sa.select(sa.literal(1))
        .select_from(runs)
        .where(runs.c.status.in_(_DONE_STATUSES))
        .limit(1)
    ).first()
    if done is None:
        raise RuntimeError(
            "The v1 -> v2 conversion has not finished on this database. Run "
            "v2.0.2 until it completes, then upgrade to this release."
        )


def drop_migration_state(bind) -> None:
    inspector = sa.inspect(bind)
    notifications = sa.table("notifications", sa.column("type"))
    bind.execute(
        notifications.delete().where(
            notifications.c.type.in_(_MIGRATION_NOTIFICATION_TYPES)
        )
    )
    for table in (*_MIGRATION_TABLES, *_VIRTUAL_VIEW_TABLES):
        if inspector.has_table(table):
            op.drop_table(table)
    member_columns = {c["name"] for c in inspector.get_columns("members")}
    for column in _MEMBER_BRIDGE_COLUMNS:
        if column in member_columns:
            op.drop_column("members", column)


def upgrade() -> None:
    bind = op.get_bind()
    ensure_conversion_finished(bind)
    drop_migration_state(bind)


def downgrade() -> None:
    raise NotImplementedError(
        "v2_1_0_drop_v1_migration_state dropped data that cannot be rebuilt; "
        "restore a backup taken before the upgrade instead."
    )
