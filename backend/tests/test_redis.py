"""Tests for the optional Redis integration.

Redis is external and optional.  The test suite never connects to a real
Redis instance — it relies on monkeypatching ``ping_redis`` and the
``REDIS_URL`` setting.
"""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.config import settings
from app.db import redis as redis_module
from tests.conftest import API

# ---------------------------------------------------------------------------
# get_redis() — module-level lazy singleton
# ---------------------------------------------------------------------------


def test_get_redis_returns_none_when_url_unset(monkeypatch):
    """get_redis() must return None when REDIS_URL is not configured."""
    monkeypatch.setattr(settings, "REDIS_URL", None)
    # Reset any cached singleton from a previous run.
    monkeypatch.setattr(redis_module, "_client", None)
    assert redis_module.get_redis() is None


def test_get_redis_returns_client_when_url_set(monkeypatch):
    """get_redis() must return a Redis client when REDIS_URL is configured."""
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_module, "_client", None)
    client = redis_module.get_redis()
    assert client is not None
    # Clean up: reset the module singleton so we don't leak state.
    monkeypatch.setattr(redis_module, "_client", None)


# ---------------------------------------------------------------------------
# ping_redis() — connection stalls
# ---------------------------------------------------------------------------


def test_ping_redis_times_out_when_connection_stalls(monkeypatch):
    """ping_redis() must not hang forever when Redis accepts the connection
    but never responds (e.g. traffic silently dropped rather than refused) —
    otherwise /health/ready would stall past the Compose healthcheck's 5s
    timeout even though the outage is meant to be non-fatal."""
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")

    class _HangingClient:
        async def ping(self):
            await asyncio.Event().wait()  # never resolves

    monkeypatch.setattr(redis_module, "get_redis", lambda: _HangingClient())

    # Outer bound is just a test safety net; ping_redis() should return well
    # before it via its own internal timeout.
    result = asyncio.run(asyncio.wait_for(redis_module.ping_redis(), timeout=5.0))
    assert result is False


# ---------------------------------------------------------------------------
# /health/ready — helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def health_app(tmp_path):
    """A minimal FastAPI app that exposes only the health/ready endpoint.

    Uses an in-memory SQLite engine so no real Postgres is needed; the
    ``SELECT 1`` check in ``health_ready`` works identically on SQLite.
    """
    from fastapi.responses import JSONResponse

    from app.db import redis as _redis_mod

    sqlite_engine = create_engine(
        f"sqlite:///{tmp_path / 'health_test.db'}",
        connect_args={"check_same_thread": False},
    )

    fapp = FastAPI()

    @fapp.get(f"{settings.API_PREFIX}/health/ready")
    async def health_ready_proxy():
        # Inline the same logic as main.health_ready, but using our
        # SQLite engine so no Postgres connection is needed.
        db_ok = True
        try:
            with sqlite_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception:
            db_ok = False

        body: dict = {
            "status": "ok" if db_ok else "error",
            "db": "ok" if db_ok else "unavailable",
        }

        if settings.redis_enabled:
            redis_ok = await _redis_mod.ping_redis()
            body["redis"] = "ok" if redis_ok else "unavailable"
            if not redis_ok and body["status"] != "error":
                body["status"] = "error" if settings.REDIS_REQUIRED else "degraded"

        if body["status"] == "error":
            return JSONResponse(status_code=503, content=body)
        return body

    return fapp


@pytest.fixture()
def health_client(health_app):
    return TestClient(health_app)


# ---------------------------------------------------------------------------
# /health/ready — no Redis configured
# ---------------------------------------------------------------------------


def test_health_ready_no_redis_omits_redis_key(health_client, monkeypatch):
    """When REDIS_URL is unset the response must NOT contain a 'redis' key."""
    monkeypatch.setattr(settings, "REDIS_URL", None)
    monkeypatch.setattr(redis_module, "_client", None)

    resp = health_client.get(f"{API}/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert "redis" not in body
    assert body["db"] == "ok"
    assert body["status"] == "ok"


def test_health_ready_no_redis_does_not_503(health_client, monkeypatch):
    """An unconfigured Redis must never cause a 503."""
    monkeypatch.setattr(settings, "REDIS_URL", None)
    monkeypatch.setattr(redis_module, "_client", None)

    resp = health_client.get(f"{API}/health/ready")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# /health/ready — Redis configured and healthy
# ---------------------------------------------------------------------------


def test_health_ready_redis_ok(health_client, monkeypatch):
    """When Redis is configured and reachable the response contains redis: ok."""
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_module, "_client", None)

    # Monkeypatch ping_redis so no real Redis connection is attempted.
    async def _ping_ok() -> bool:
        return True

    monkeypatch.setattr(redis_module, "ping_redis", _ping_ok)

    resp = health_client.get(f"{API}/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["redis"] == "ok"
    assert body["status"] == "ok"


def test_health_ready_redis_unavailable_degrades_by_default(health_client, monkeypatch):
    """An optional (non-required) Redis outage stays ready, but degraded."""
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(settings, "REDIS_REQUIRED", False)
    monkeypatch.setattr(redis_module, "_client", None)

    async def _ping_fail() -> bool:
        return False

    monkeypatch.setattr(redis_module, "ping_redis", _ping_fail)

    resp = health_client.get(f"{API}/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["redis"] == "unavailable"
    assert body["status"] == "degraded"


# ---------------------------------------------------------------------------
# /health/ready — Redis configured and required
# ---------------------------------------------------------------------------


def test_health_ready_redis_required_and_healthy(health_client, monkeypatch):
    """A required Redis that is reachable keeps readiness ok."""
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(settings, "REDIS_REQUIRED", True)
    monkeypatch.setattr(redis_module, "_client", None)

    async def _ping_ok() -> bool:
        return True

    monkeypatch.setattr(redis_module, "ping_redis", _ping_ok)

    resp = health_client.get(f"{API}/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["redis"] == "ok"
    assert body["status"] == "ok"


def test_health_ready_redis_required_and_unavailable_returns_503(
    health_client, monkeypatch
):
    """When Redis is required but unreachable the endpoint returns 503."""
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(settings, "REDIS_REQUIRED", True)
    monkeypatch.setattr(redis_module, "_client", None)

    async def _ping_fail() -> bool:
        return False

    monkeypatch.setattr(redis_module, "ping_redis", _ping_fail)

    resp = health_client.get(f"{API}/health/ready")
    assert resp.status_code == 503
    body = resp.json()
    assert body["redis"] == "unavailable"
    assert body["status"] == "error"
