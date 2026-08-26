"""Unit tests for the single-leader advisory lock and its use by the
background-loop wrappers."""

import contextlib

import pytest
from sqlalchemy import create_engine

from app.db.advisory_lock import single_leader


class _FakeResult:
    def __init__(self, value) -> None:
        self._value = value

    def scalar(self):
        return self._value


class _FakeConn:
    def __init__(self, acquired: bool) -> None:
        self._acquired = acquired
        self.unlocked = False
        self.closed = False

    def execute(self, statement, params=None):
        sql = str(statement)
        if "pg_try_advisory_lock" in sql:
            return _FakeResult(self._acquired)
        if "pg_advisory_unlock" in sql:
            self.unlocked = True
            return _FakeResult(True)
        return _FakeResult(None)

    def close(self) -> None:
        self.closed = True


class _FakeEngine:
    def __init__(self, acquired: bool) -> None:
        self.conn = _FakeConn(acquired)

    def connect(self):
        return self.conn


def test_acquires_and_releases_when_free():
    engine = _FakeEngine(acquired=True)
    with single_leader(1, engine=engine) as is_leader:
        assert is_leader is True
    assert engine.conn.unlocked is True
    assert engine.conn.closed is True


def test_skips_when_lock_held_elsewhere():
    engine = _FakeEngine(acquired=False)
    with single_leader(1, engine=engine) as is_leader:
        assert is_leader is False
    # We never held the lock, so we must not try to unlock it, but we must
    # still close the connection.
    assert engine.conn.unlocked is False
    assert engine.conn.closed is True


def test_degrades_to_run_without_advisory_support():
    # SQLite has no pg_try_advisory_lock -> fall back to running the work.
    engine = create_engine("sqlite://")
    with single_leader(123, engine=engine) as is_leader:
        assert is_leader is True


def test_degrades_to_run_on_connect_failure():
    class _BoomEngine:
        def connect(self):
            raise RuntimeError("database unreachable")

    with single_leader(1, engine=_BoomEngine()) as is_leader:
        assert is_leader is True


def test_body_exception_still_releases_and_closes():
    engine = _FakeEngine(acquired=True)
    with contextlib.suppress(ValueError), single_leader(1, engine=engine):
        raise ValueError("boom")
    assert engine.conn.unlocked is True
    assert engine.conn.closed is True


# --- loop wrappers honour the leader election ------------------------------


def _patch_leader(monkeypatch, module, is_leader: bool):
    @contextlib.contextmanager
    def fake_leader(_key, **_kwargs):
        yield is_leader

    monkeypatch.setattr(module, "single_leader", fake_leader)


def test_sweep_runs_only_when_leader(monkeypatch):
    import app.services.system.deletion_sweeper as ds

    calls: list[bool] = []
    monkeypatch.setattr(ds, "_run_sweep_once", lambda: calls.append(True))

    _patch_leader(monkeypatch, ds, is_leader=False)
    ds._sweep_if_leader()
    assert calls == []

    _patch_leader(monkeypatch, ds, is_leader=True)
    ds._sweep_if_leader()
    assert calls == [True]


def test_backup_check_runs_only_when_leader(monkeypatch):
    import app.services.system.backups.backup_scheduler as bs

    calls: list[bool] = []
    monkeypatch.setattr(bs, "_run_if_due", lambda: calls.append(True))

    _patch_leader(monkeypatch, bs, is_leader=False)
    bs._check_if_leader()
    assert calls == []

    _patch_leader(monkeypatch, bs, is_leader=True)
    bs._check_if_leader()
    assert calls == [True]


# --- exclusive_lock (#994) ---------------------------------------------------


class _FakeBlockingConn:
    def __init__(self) -> None:
        self.locked = False
        self.unlocked = False
        self.closed = False

    def execute(self, statement, params=None):
        sql = str(statement)
        if "pg_advisory_lock" in sql and "unlock" not in sql:
            self.locked = True
            return _FakeResult(None)
        if "pg_advisory_unlock" in sql:
            self.unlocked = True
            return _FakeResult(True)
        return _FakeResult(None)

    def close(self) -> None:
        self.closed = True


class _FakeBlockingEngine:
    def __init__(self) -> None:
        self.conn = _FakeBlockingConn()

    def connect(self):
        return self.conn


def test_exclusive_lock_acquires_and_releases():
    from app.db.advisory_lock import exclusive_lock

    engine = _FakeBlockingEngine()
    with exclusive_lock(1, engine=engine):
        assert engine.conn.locked is True
    assert engine.conn.unlocked is True
    assert engine.conn.closed is True


def test_exclusive_lock_raises_on_connect_failure():
    from app.db.advisory_lock import AdvisoryLockUnavailableError, exclusive_lock

    class _BoomEngine:
        def connect(self):
            raise RuntimeError("database unreachable")

    with pytest.raises(AdvisoryLockUnavailableError):
        with exclusive_lock(1, engine=_BoomEngine()):
            pytest.fail("body must not run without the lock")


def test_exclusive_lock_raises_without_advisory_support():
    from app.db.advisory_lock import AdvisoryLockUnavailableError, exclusive_lock

    # SQLite has no pg_advisory_lock -> fail closed rather than degrade.
    engine = create_engine("sqlite://")
    with pytest.raises(AdvisoryLockUnavailableError):
        with exclusive_lock(123, engine=engine):
            pytest.fail("body must not run without the lock")


def test_exclusive_lock_releases_on_body_exception():
    from app.db.advisory_lock import exclusive_lock

    engine = _FakeBlockingEngine()
    with contextlib.suppress(ValueError), exclusive_lock(1, engine=engine):
        raise ValueError("boom")
    assert engine.conn.unlocked is True
    assert engine.conn.closed is True
