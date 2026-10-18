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

    @app.get(f"{settings.API_PREFIX}/workspaces")
    def list_workspaces():
        return []

    return TestClient(app)


def test_ordinary_routes_are_gated_while_startup_is_in_progress():
    client = _make_client()
    resp = client.get(f"{settings.API_PREFIX}/workspaces")
    assert resp.status_code == 503
    assert resp.json()["detail"] == "startup_in_progress"


def test_health_stays_reachable_while_gated():
    client = _make_client()
    assert client.get(f"{settings.API_PREFIX}/health").status_code == 200


def test_ordinary_routes_open_up_once_startup_completes():
    client = _make_client()
    runtime.set_startup_complete(True)
    resp = client.get(f"{settings.API_PREFIX}/workspaces")
    assert resp.status_code == 200


def test_health_ready_reports_starting_before_startup_completes():
    resp = asyncio.run(health_ready())
    assert resp.status_code == 503
    assert resp.body == b'{"status":"starting","db":"unknown"}'


def test_startup_success_returns_true(monkeypatch):
    monkeypatch.setattr(main_module, "_init_db_with_retry", lambda: None)
    kill_calls = []
    monkeypatch.setattr(
        main_module.os, "kill", lambda pid, sig: kill_calls.append((pid, sig))
    )

    result = asyncio.run(main_module._run_startup_or_die())

    assert result is True
    assert kill_calls == []


def test_startup_failure_signals_sigterm_instead_of_hanging(monkeypatch):
    def _boom():
        raise RuntimeError("database still on v1")

    monkeypatch.setattr(main_module, "_init_db_with_retry", _boom)
    kill_calls = []
    monkeypatch.setattr(
        main_module.os, "kill", lambda pid, sig: kill_calls.append((pid, sig))
    )

    result = asyncio.run(main_module._run_startup_or_die())

    assert result is False
    assert kill_calls == [(main_module.os.getpid(), signal.SIGTERM)]

