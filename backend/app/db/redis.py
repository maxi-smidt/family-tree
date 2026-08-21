"""Lazy, connection-pooled async Redis client.

Redis is **optional** and **external** — not bundled in the compose stack.
When ``REDIS_URL`` is unset every function degrades gracefully:

* ``get_redis()`` returns ``None``
* ``ping_redis()`` returns ``False``
* ``close_redis()`` is a no-op

When ``REDIS_URL`` is set a single pooled client is created on first use
and cached for the lifetime of the process. Every operation is bounded by a
short socket timeout so a Redis host that accepts connections but never
responds (traffic silently dropped, not refused) fails fast instead of
hanging — that matters most for ``/health/ready``, which must return well
inside the Compose healthcheck's timeout even when Redis is optional and
degraded.
"""

import asyncio
import logging

from redis.asyncio import Redis
from redis.asyncio import from_url as _from_url

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: Redis | None = None

# Applied both at the socket level (connect/read) and as an application-level
# ceiling around ping_redis() itself, well under the Compose healthcheck's
# 5s timeout.
_TIMEOUT_SECONDS = 2.0


def get_redis() -> Redis | None:
    """Return the pooled async Redis client, creating it on first call.

    Returns ``None`` when ``REDIS_URL`` is not configured.
    """
    global _client  # noqa: PLW0603

    if not settings.REDIS_URL:
        return None

    if _client is None:
        _client = _from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=_TIMEOUT_SECONDS,
            socket_timeout=_TIMEOUT_SECONDS,
        )
        logger.info("Redis client initialised (url configured)")

    return _client


async def close_redis() -> None:
    """Close the Redis connection pool.

    Safe to call even when Redis was never initialised.
    """
    global _client  # noqa: PLW0603

    if _client is None:
        return

    try:
        await _client.aclose()
    except Exception:
        logger.exception("Error closing Redis client")
    finally:
        _client = None


async def ping_redis() -> bool:
    """Return ``True`` if the configured Redis responds to PING.

    Returns ``False`` when Redis is not configured or is unreachable.
    Never raises.
    """
    client = get_redis()
    if client is None:
        return False
    try:
        return bool(await asyncio.wait_for(client.ping(), timeout=_TIMEOUT_SECONDS))
    except Exception:
        logger.warning("Redis ping failed", exc_info=True)
        return False
