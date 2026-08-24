"""Thin async caching helpers built on the optional Redis client.

All public functions degrade gracefully when Redis is not configured
(``get_redis()`` returns ``None``) or when any Redis operation fails.
Errors are logged and swallowed — they must never surface into the HTTP
request path.

Usage example::

    from app.services.cache import cache_get_json, cache_set_json, stats_key

    data = await cache_get_json(stats_key(workspace_id))
    if data is None:
        data = compute_heavy_thing()
        await cache_set_json(stats_key(workspace_id), data, STATS_TTL_SECONDS)
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# TTL constants
# ---------------------------------------------------------------------------

# Statistics reports are cached for 5 minutes.  A write invalidates the key
# immediately; the TTL is a backstop for missed invalidations.
STATS_TTL_SECONDS = 300


# ---------------------------------------------------------------------------
# Key helpers
# ---------------------------------------------------------------------------


def stats_key(workspace_id: str) -> str:
    """Return the Redis key for the statistics cache of *workspace_id*."""
    return f"cache:stats:{workspace_id}"


# ---------------------------------------------------------------------------
# Async helpers
# ---------------------------------------------------------------------------


async def cache_get_json(key: str) -> Any | None:
    """Return the JSON-parsed value stored at *key*, or ``None`` on miss/error.

    Returns ``None`` when:
    - Redis is not configured (``REDIS_URL`` unset).
    - The key is not present in Redis (cache miss).
    - Any Redis or JSON error occurs (degrades gracefully).
    """
    from app.db.redis import get_redis  # local import to avoid circular deps

    client = get_redis()
    if client is None:
        return None
    try:
        raw: str | None = await client.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception:
        logger.warning("cache_get_json failed for key %r", key, exc_info=True)
        return None


async def cache_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    """Serialize *value* as JSON and store it at *key* with an EX TTL.

    No-op when Redis is not configured.  Errors are logged and swallowed.
    """
    from app.db.redis import get_redis  # local import

    client = get_redis()
    if client is None:
        return
    try:
        payload = json.dumps(value)
        await client.set(key, payload, ex=ttl_seconds)
    except Exception:
        logger.warning("cache_set_json failed for key %r", key, exc_info=True)


async def cache_delete(*keys: str) -> None:
    """Delete one or more *keys* from Redis.

    No-op when Redis is not configured or *keys* is empty.  Errors are
    logged and swallowed.
    """
    from app.db.redis import get_redis  # local import

    if not keys:
        return
    client = get_redis()
    if client is None:
        return
    try:
        await client.delete(*keys)
    except Exception:
        logger.warning("cache_delete failed for keys %r", keys, exc_info=True)


# ---------------------------------------------------------------------------
# Sync-safe invalidation helper for use from sync FastAPI route handlers
# ---------------------------------------------------------------------------


def invalidate_stats(workspace_id: str) -> None:
    """Best-effort cache invalidation for a tree's statistics key.

    Designed to be called from **sync** FastAPI route handlers (which run in
    a threadpool).  It schedules the async ``cache_delete`` coroutine on the
    already-running event loop via ``asyncio.run_coroutine_threadsafe`` —
    mirroring the pattern used by ``event_bus.publish`` for Redis PUBLISH
    calls.

    When the event loop is not yet available (e.g. during import time or in
    tests that never start a loop), the call is silently skipped.  Errors are
    always swallowed so a cache miss never propagates into the request path.
    """
    from app.core.runtime import get_loop  # local import to avoid circular

    loop = get_loop()
    if loop is None or loop.is_closed():
        return
    try:
        asyncio.run_coroutine_threadsafe(cache_delete(stats_key(workspace_id)), loop)
    except Exception:
        logger.warning(
            "invalidate_stats: failed to schedule cache delete for tree %r",
            workspace_id,
            exc_info=True,
        )
