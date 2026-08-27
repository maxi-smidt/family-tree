"""Physically drops the legacy tree-in-tree bridge columns and virtual-view
tables (#1021), once it is safe to do so.

This is deliberately *not* an Alembic migration: every ``v2_0_0_*`` revision's
``upgrade()`` runs before ``app.services.migration.converter.run_conversion``
ever executes (see ``app.services.migration.orchestrator``), so a plain
``drop_column``/``drop_table`` migration would destroy the bridge/virtual-view
data a v1-to-v2 upgrade still needs to read, before conversion gets a chance
to read it. Instead this runs as plain DDL, triggered only once conversion is
known to be done for this database: from a fresh v2 install (nothing to
convert) and from an operator's explicit ``finalize`` of a real migration run
(see ``app.services.migration.state_machine.finalize_run``).

Checks for each column/table's existence via reflection first rather than
relying on ``DROP COLUMN IF EXISTS`` (a Postgres-only extension the test
suite's SQLite dialect doesn't support), so this is both portable and
idempotent — a resumed/retried caller, or a second call after a previous one
already succeeded, is always a safe no-op.
"""

from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

# Children before the ``virtual_views`` parent they reference.
_VIRTUAL_VIEW_TABLES = (
    "virtual_view_user_states",
    "virtual_view_sources",
    "virtual_view_member_matches",
    "virtual_view_positions",
    "virtual_views",
)

_MEMBER_BRIDGE_COLUMNS = ("linked_member_id", "linked_workspace_id")


def drop_legacy_structures(db: Session) -> None:
    """Drop the legacy bridge columns and virtual-view tables, if present."""
    inspector = inspect(db.connection())
    existing_member_columns = {c["name"] for c in inspector.get_columns("members")}
    for column in _MEMBER_BRIDGE_COLUMNS:
        if column in existing_member_columns:
            db.execute(text(f'ALTER TABLE members DROP COLUMN "{column}"'))
    for table in _VIRTUAL_VIEW_TABLES:
        if inspector.has_table(table):
            db.execute(text(f'DROP TABLE "{table}"'))
