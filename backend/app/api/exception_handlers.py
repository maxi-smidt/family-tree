"""Maps domain exceptions to HTTP responses.

Kept separate from ``app.core.exceptions`` so that module stays free of any
FastAPI import — services and background jobs depend only on the exception
types, never on how they get turned into a response.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.exceptions import DomainError


def install_domain_error_handler(app: FastAPI) -> None:
    """Register the JSON-response handler for every ``DomainError`` subclass."""

    @app.exception_handler(DomainError)
    async def _handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
