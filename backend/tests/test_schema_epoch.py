"""Tests for the schema-epoch mutation gate (#1012).

``app.main.SchemaEpochMiddleware`` only wraps the real app (``app.main.app``),
not the bare-router ``client`` fixture other tests use, so it's exercised
here against a minimal app built the same way ``app.main`` builds its own.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.schema_epoch import SCHEMA_EPOCH, SCHEMA_EPOCH_HEADER
from app.main import SchemaEpochMiddleware


def _make_client() -> TestClient:
    app = FastAPI()
    app.add_middleware(SchemaEpochMiddleware)

    @app.get(f"{settings.API_PREFIX}/health")
    def health():
        return {"status": "ok"}

    @app.get(f"{settings.API_PREFIX}/auth/config")
    def auth_config():
        return {"schema_epoch": SCHEMA_EPOCH}

    @app.post(f"{settings.API_PREFIX}/auth/login")
    def login():
        return {"ok": True}

    @app.get(f"{settings.API_PREFIX}/workspaces")
    def list_workspaces():
        return []

    @app.post(f"{settings.API_PREFIX}/workspaces")
    def create_workspace():
        return {"ok": True}

    return TestClient(app)


def test_get_requests_never_require_the_epoch_header():
    client = _make_client()
    resp = client.get(f"{settings.API_PREFIX}/workspaces")
    assert resp.status_code == 200


def test_mutation_without_the_header_is_rejected():
    client = _make_client()
    resp = client.post(f"{settings.API_PREFIX}/workspaces")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "schema_epoch_mismatch"


def test_mutation_with_a_stale_epoch_is_rejected():
    client = _make_client()
    resp = client.post(
        f"{settings.API_PREFIX}/workspaces",
        headers={SCHEMA_EPOCH_HEADER: str(SCHEMA_EPOCH - 1)},
    )
    assert resp.status_code == 409


def test_mutation_with_the_current_epoch_passes_through():
    client = _make_client()
    resp = client.post(
        f"{settings.API_PREFIX}/workspaces",
        headers={SCHEMA_EPOCH_HEADER: str(SCHEMA_EPOCH)},
    )
    assert resp.status_code == 200


def test_auth_and_health_are_exempt_so_bootstrap_never_gets_blocked():
    client = _make_client()
    assert client.post(f"{settings.API_PREFIX}/auth/login").status_code == 200
    assert client.get(f"{settings.API_PREFIX}/health").status_code == 200
