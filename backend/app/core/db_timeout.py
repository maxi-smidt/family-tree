"""Scoped Postgres statement timeout for expensive read endpoints (#983).

SQLite (used in tests) has no ``statement_timeout`` equivalent, so the guard
is a no-op there — this stays purely an operational safety net for the real
deployment target.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.exceptions import DomainError

_QUERY_CANCELED = "57014"


class QueryTimeoutError(DomainError):
    status_code = 504

    def __init__(self) -> None:
        super().__init__("query_timeout")


def _is_query_canceled(exc: OperationalError) -> bool:
    return getattr(exc.orig, "pgcode", None) == _QUERY_CANCELED


@contextmanager
def statement_timeout(db: Session, milliseconds: int) -> Iterator[None]:
    """Cap Postgres query time for the rest of this transaction.

    ``SET LOCAL`` scopes the limit to the current transaction, so it clears
    itself when the request-scoped session closes — no cleanup needed. A
    query that runs past the limit raises ``QueryTimeoutError`` (504) instead
    of bubbling up as an unhandled 500.
    """
    if db.get_bind().dialect.name != "postgresql":
        yield
        return
    db.execute(text(f"SET LOCAL statement_timeout = {int(milliseconds)}"))
    try:
        yield
    except OperationalError as exc:
        if _is_query_canceled(exc):
            raise QueryTimeoutError() from exc
        raise
