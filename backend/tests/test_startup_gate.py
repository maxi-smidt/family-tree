"""Tests for the startup gate (#1020).

``app.main.StartupGateMiddleware`` only wraps the real app (``app.main.app``),
not the bare-router ``client`` fixture other tests use, so it's exercised
here against a minimal app built the same way ``test_schema_epoch.py`` does
for ``SchemaEpochMiddleware``.
"""

import asyncio
import signal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError, ProgrammingError

import app.main as main_module
from app.core import runtime
from app.core.config import settings
from app.main import StartupGateMiddleware, health_ready


@pytest.fixture(autouse=True)
def _reset_startup_flag():
    runtime.set_startup_complete(False)
    yield
    runtime.set_startup_complete(False)


def _make_client() -> TestClient:
    app = FastAPI()
    app.add_middleware(StartupGateMiddleware)

    @app.get(f"{settings.API_PREFIX}/health")
    def health():
        return {"status": "ok"}

    @app.get(f"{settings.API_PREFIX}/health/migration")
    def health_migration():
        return {"status": "backup"}

    @app.get(f"{settings.API_PREFIX}/workspaces")
    def list_workspaces():
        return []

    return TestClient(app)


def test_ordinary_routes_are_gated_while_startup_is_in_progress():
    client = _make_client()
    resp = client.get(f"{settings.API_PREFIX}/workspaces")
    assert resp.status_code == 503
    assert resp.json()["detail"] == "startup_in_progress"


def test_health_and_migration_status_stay_reachable_while_gated():
    client = _make_client()
    assert client.get(f"{settings.API_PREFIX}/health").status_code == 200
    assert client.get(f"{settings.API_PREFIX}/health/migration").status_code == 200


def test_ordinary_routes_open_up_once_startup_completes():
    client = _make_client()
    runtime.set_startup_complete(True)
    resp = client.get(f"{settings.API_PREFIX}/workspaces")
    assert resp.status_code == 200


def test_health_ready_reports_starting_before_startup_completes():
    resp = asyncio.run(health_ready())
    assert resp.status_code == 503
    assert resp.body == b'{"status":"starting","db":"unknown"}'


def test_startup_migration_success_returns_true(monkeypatch):
    monkeypatch.setattr(main_module, "_init_db_with_retry", lambda: None)
    kill_calls = []
    monkeypatch.setattr(
        main_module.os, "kill", lambda pid, sig: kill_calls.append((pid, sig))
    )

    result = asyncio.run(main_module._run_startup_migration_or_die())

    assert result is True
    assert kill_calls == []


def test_startup_migration_failure_signals_sigterm_instead_of_hanging(monkeypatch):
    def _boom():
        raise RuntimeError("preflight failed: disk full")

    monkeypatch.setattr(main_module, "_init_db_with_retry", _boom)
    kill_calls = []
    monkeypatch.setattr(
        main_module.os, "kill", lambda pid, sig: kill_calls.append((pid, sig))
    )

    result = asyncio.run(main_module._run_startup_migration_or_die())

    assert result is False
    assert kill_calls == [(main_module.os.getpid(), signal.SIGTERM)]


class _RaisingSession:
    """Stands in for ``SessionLocal()`` when a query against it must raise."""

    def __init__(self, exc: Exception):
        self._exc = exc
        self.rolled_back = False

    def __enter__(self):
        return self

    def __exit__(self, *_exc_info):
        return False

    def scalars(self, *_args, **_kwargs):
        raise self._exc

    def rollback(self):
        self.rolled_back = True


def test_latest_migration_run_treats_a_missing_table_as_no_run_yet(monkeypatch):
    session = _RaisingSession(
        ProgrammingError("SELECT ...", {}, Exception("undefined_table"))
    )
    monkeypatch.setattr(main_module, "SessionLocal", lambda: session)

    result = main_module._latest_migration_run()

    assert result is None
    assert session.rolled_back is True


def test_health_migration_surfaces_a_genuine_database_outage(monkeypatch):
    session = _RaisingSession(
        OperationalError("SELECT ...", {}, Exception("connection refused"))
    )
    monkeypatch.setattr(main_module, "SessionLocal", lambda: session)

    resp = asyncio.run(main_module.health_migration())

    assert resp.status_code == 503
    assert resp.body == b'{"status":"unavailable"}'
