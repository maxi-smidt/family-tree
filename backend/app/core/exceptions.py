"""Domain exceptions raised by application services.

Services raise one of these instead of ``fastapi.HTTPException``, keeping
business logic free of an HTTP-framework dependency (reusable from background
jobs, testable in isolation). ``install_domain_error_handler`` registers the
one handler that maps every ``DomainError`` subclass to its HTTP response —
called for both the real app (``app.main``) and the test app (``conftest``).
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class DomainError(Exception):
    """Base class for application-level errors.

    ``status_code`` is the HTTP status the centralized handler maps this
    error to.
    """

    status_code = 400

    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)


class NotFoundError(DomainError):
    status_code = 404


class InvalidInputError(DomainError):
    status_code = 400


class AccessDeniedError(DomainError):
    status_code = 403


class ConflictError(DomainError):
    status_code = 409


def install_domain_error_handler(app: FastAPI) -> None:
    """Register the JSON-response handler for every ``DomainError`` subclass."""

    @app.exception_handler(DomainError)
    async def _handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
