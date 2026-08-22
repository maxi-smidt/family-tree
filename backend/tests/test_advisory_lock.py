"""Unit tests for the single-leader advisory lock and its use by the
background-loop wrappers."""

import contextlib

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
