"""Portable ``INSERT ... ON CONFLICT DO UPDATE`` for the dialects this app
runs under (Postgres in production, SQLite in tests).

A plain check-then-insert (``db.get(Model, pk)``, then add-or-update) races:
two concurrent requests can both see no row and both attempt the insert, and
one loses with a primary-key violation. This performs the insert-or-update as
a single atomic statement instead.
"""

from typing import Any

from sqlalchemy.orm import Session


def upsert_row(
    db: Session,
    model: type,
    values: dict[str, Any],
    index_elements: list[str],
) -> None:
    """Insert ``values`` into ``model``'s table, or update the row already
    there on ``index_elements`` (its primary/unique key) with the same
    non-key values."""
    if db.get_bind().dialect.name == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        from sqlalchemy.dialects.postgresql import insert

    stmt = insert(model).values(**values)
    update_cols = {k: v for k, v in values.items() if k not in index_elements}
    stmt = stmt.on_conflict_do_update(index_elements=index_elements, set_=update_cols)
    db.execute(stmt)
