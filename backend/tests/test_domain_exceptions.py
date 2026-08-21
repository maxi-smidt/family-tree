"""The centralized DomainError -> HTTP mapping (#896).

Application services raise typed domain exceptions instead of importing
FastAPI's ``HTTPException`` directly; ``install_domain_error_handler`` (used
by both ``app.main`` and the ``client`` test fixture) is what turns those
back into HTTP responses. Exercised end-to-end elsewhere (e.g.
test_extract_move.py, test_documents_atomic.py); this file tests the mapping
itself, isolated from any particular service.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.exceptions import (
    AccessDeniedError,
    ConflictError,
    DomainError,
    InvalidInputError,
    NotFoundError,
    install_domain_error_handler,
)


@pytest.fixture()
def domain_error_client():
    app = FastAPI()
    install_domain_error_handler(app)

    @app.get("/raise/{name}")
    def raise_error(name: str):
        raise {
            "not-found": NotFoundError,
            "invalid-input": InvalidInputError,
            "access-denied": AccessDeniedError,
            "conflict": ConflictError,
        }[name]("boom")

    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize(
    ("name", "status_code"),
    [
        ("not-found", 404),
        ("invalid-input", 400),
        ("access-denied", 403),
        ("conflict", 409),
    ],
)
def test_domain_error_maps_to_its_status_code(domain_error_client, name, status_code):
    resp = domain_error_client.get(f"/raise/{name}")
    assert resp.status_code == status_code
    assert resp.json() == {"detail": "boom"}


def test_domain_error_subclasses_share_the_base_handler():
    """A custom DomainError subclass with no dedicated handler still maps,
    proving the handler is registered on the base class."""

    class QuotaError(DomainError):
        status_code = 413

    app = FastAPI()
    install_domain_error_handler(app)

    @app.get("/quota")
    def raise_quota():
        raise QuotaError("over quota")

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/quota")
    assert resp.status_code == 413
    assert resp.json() == {"detail": "over quota"}
