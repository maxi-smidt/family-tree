"""Domain exceptions raised by application services.

Services raise one of these instead of ``fastapi.HTTPException``, keeping
business logic free of an HTTP-framework dependency (reusable from background
jobs, testable in isolation). ``app.api.exception_handlers`` maps every
``DomainError`` subclass to its HTTP response.
"""

from typing import Literal


class DomainError(Exception):
    """Base class for application-level errors.

    ``status_code`` is the HTTP status the API layer maps this error to.
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


class QuotaExceeded(DomainError):
    """Raised when a write would push usage past a quota limit."""

    status_code = 413

    def __init__(
        self,
        bucket: Literal["tree", "media"],
        limit_bytes: int,
        current_bytes: int,
        would_be_bytes: int,
    ) -> None:
        self.bucket = bucket
        self.limit_bytes = limit_bytes
        self.current_bytes = current_bytes
        self.would_be_bytes = would_be_bytes
        super().__init__(f"quota_exceeded_{bucket}")
