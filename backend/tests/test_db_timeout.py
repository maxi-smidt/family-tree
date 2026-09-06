"""Postgres statement-timeout guard for expensive read endpoints (#983)."""

from types import SimpleNamespace

import pytest
from sqlalchemy.exc import OperationalError

from app.core.db_timeout import QueryTimeoutError, statement_timeout


class _FakeSession:
    """Stands in for a ``Session`` bound to a given SQL dialect."""

    def __init__(self, dialect_name: str) -> None:
        self.dialect_name = dialect_name
        self.executed: list[str] = []

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name=self.dialect_name))

    def execute(self, statement):
        self.executed.append(str(statement))


def _query_canceled() -> OperationalError:
    return OperationalError("SELECT 1", {}, SimpleNamespace(pgcode="57014"))


def test_sqlite_dialect_is_a_no_op():
    """Tests run on SQLite, which has no ``statement_timeout`` — nothing runs."""
    db = _FakeSession("sqlite")
    with statement_timeout(db, 5000):
        pass
    assert db.executed == []


def test_postgres_sets_local_statement_timeout():
    db = _FakeSession("postgresql")
    with statement_timeout(db, 5000):
        pass
    assert any("statement_timeout" in stmt and "5000" in stmt for stmt in db.executed)


def test_query_canceled_becomes_query_timeout_error():
    db = _FakeSession("postgresql")
    with pytest.raises(QueryTimeoutError):
        with statement_timeout(db, 5000):
            raise _query_canceled()


def test_other_operational_errors_are_not_swallowed():
    db = _FakeSession("postgresql")
    other = OperationalError("SELECT 1", {}, SimpleNamespace(pgcode="08006"))
    with pytest.raises(OperationalError):
        with statement_timeout(db, 5000):
            raise other
