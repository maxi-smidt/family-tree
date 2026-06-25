"""Optional error monitoring via Sentry / GlitchTip.

Initialisation is a complete no-op when ``SENTRY_DSN`` is not set, so
instances that choose not to use error monitoring are unaffected.

PII scrubbing
-------------
``_scrub`` is applied to every event before it leaves the process.  It:

- drops ``request.cookies`` entirely
- drops auth-related request headers (Authorization, Cookie, Set-Cookie)
- removes the ``request.data`` body
- strips the query string from the request URL
- removes the ``user.email`` field from the Sentry ``user`` context
- redacts values that look like e-mail addresses or JWT-ish bearer tokens
- drops breadcrumbs whose ``message`` references a media URL (``/media/``)
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger("app")

# Patterns for value-level PII redaction.
_EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
_JWT_RE = re.compile(r"ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")

_SENSITIVE_HEADERS = {"authorization", "cookie", "set-cookie"}


def _redact_value(value: object) -> object:
    """Redact e-mail addresses and JWT-like tokens inside string values."""
    if not isinstance(value, str):
        return value
    value = _EMAIL_RE.sub("[email]", value)
    value = _JWT_RE.sub("[token]", value)
    return value


def _scrub(event: dict, hint: object) -> dict:  # noqa: ARG001
    """Sentry ``before_send`` hook — strip PII before the event is sent."""
    request = event.get("request") or {}

    # --- headers -----------------------------------------------------------
    headers: dict = request.get("headers") or {}
    cleaned_headers = {
        k: ("[filtered]" if k.lower() in _SENSITIVE_HEADERS else _redact_value(v))
        for k, v in headers.items()
    }
    if cleaned_headers:
        request["headers"] = cleaned_headers

    # --- cookies -----------------------------------------------------------
    if "cookies" in request:
        del request["cookies"]

    # --- body --------------------------------------------------------------
    if "data" in request:
        del request["data"]

    # --- query string ------------------------------------------------------
    if "query_string" in request:
        del request["query_string"]

    # --- rebuild URL without query params ----------------------------------
    url: str = request.get("url") or ""
    if "?" in url:
        request["url"] = url.split("?", 1)[0]

    if request:
        event["request"] = request

    # --- user context ------------------------------------------------------
    user_ctx: dict = event.get("user") or {}
    if "email" in user_ctx:
        del user_ctx["email"]
    if user_ctx:
        event["user"] = user_ctx

    # --- breadcrumbs -------------------------------------------------------
    breadcrumbs = event.get("breadcrumbs") or {}
    values: list = breadcrumbs.get("values") or []
    filtered = [
        bc
        for bc in values
        if "/media/" not in (bc.get("message") or "")
    ]
    if values:
        breadcrumbs["values"] = filtered
        event["breadcrumbs"] = breadcrumbs

    return event


def init_sentry() -> None:
    """Initialise the Sentry SDK if ``SENTRY_DSN`` is configured.

    Safe to call multiple times — the SDK is only initialised once.
    """
    from app.core.config import settings

    if not settings.sentry_enabled:
        logger.debug("Sentry not configured — error monitoring disabled")
        return

    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        release=settings.APP_VERSION,
        send_default_pii=False,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        before_send=_scrub,
    )
    logger.info(
        "Sentry error monitoring enabled (environment=%s)", settings.ENVIRONMENT
    )
