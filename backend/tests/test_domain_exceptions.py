"""The centralized DomainError -> HTTP mapping (#896).

Application services raise typed domain exceptions (``app.core.exceptions``
— NotFoundError, InvalidInputError, AccessDeniedError, ConflictError, and
QuotaExceeded all live there, and that module stays free of any FastAPI
import) instead of importing FastAPI's ``HTTPException`` directly.
``app.api.exception_handlers.install_domain_error_handler`` (used by both
``app.main`` and the ``client`` test fixture) is what turns those back into
HTTP responses, so the mapping itself lives in the API layer, not next to the
exception types. Exercised end-to-end elsewhere (e.g. test_extract_move.py,
test_documents_atomic.py); this file tests the mapping and the import
boundary in isolation.
"""

import ast
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.exception_handlers import install_domain_error_handler
from app.core.exceptions import (
    AccessDeniedError,
    ConflictError,
    DomainError,
    InvalidInputError,
    NotFoundError,
    QuotaExceeded,
)

BACKEND_ROOT = Path(__file__).resolve().parent.parent

# The exception types themselves, and the background-job runner that reads
# their .detail, must never even transitively depend on fastapi — that is the
# whole point of moving the HTTP mapping out to app.api.exception_handlers.
FASTAPI_FREE_MODULES = [
    "app.core.exceptions",
    "app.services.system.job_service",
]

# Application services that raise DomainError instead of HTTPException. Some
# of these still pull fastapi in transitively through unrelated collaborators
# (e.g. app.services.media.storage imports UploadFile for upload handling) — that
# pre-existing coupling is out of scope here. What this file must guarantee
# is narrower: these modules no longer declare a *direct* fastapi import of
# their own for error handling.
DOMAIN_SERVICE_MODULES = [
    "app.services.documents.document_service",
    "app.services.extract",
    "app.services.merge",
    "app.services.member_merge",
    "app.services.media.storage_usage",
]


@pytest.mark.parametrize("module", FASTAPI_FREE_MODULES)
def test_module_does_not_import_fastapi(module):
    """Checked in a fresh subprocess so an unrelated test that already
    imported fastapi elsewhere can't mask a regression."""
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            f"import {module}; import sys; "
            "assert 'fastapi' not in sys.modules, sys.modules.keys()",
        ],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("module", DOMAIN_SERVICE_MODULES)
def test_domain_service_declares_no_direct_fastapi_import(module):
    path = BACKEND_ROOT / Path(*module.split(".")).with_suffix(".py")
    tree = ast.parse(path.read_text(), filename=str(path))
    direct_imports = {
        alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        node.module.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    }
    assert "fastapi" not in direct_imports


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


def test_quota_exceeded_is_mapped_by_the_shared_handler():
    """QuotaExceeded lives in app.core.exceptions with the other DomainError
    subclasses (storage_usage imports it, it isn't defined there), so routers
    no longer hand-roll ``except QuotaExceeded: raise HTTPException(413, ...)``
    — the shared handler covers it like every other domain exception."""
    app = FastAPI()
    install_domain_error_handler(app)

    @app.get("/quota")
    def raise_quota():
        raise QuotaExceeded("tree", 100, 90, 120)

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/quota")
    assert resp.status_code == 413
    assert resp.json() == {"detail": "quota_exceeded_tree"}
