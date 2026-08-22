"""Live-collaboration presence registry.

Tracks *who* is currently active in each tree — a lightweight, ephemeral
counterpart to the SSE event bus.  Clients POST heartbeats (~every 30 s, and
whenever they open/close a member sheet in edit mode); the registry keeps
``tree_id -> {user_id: {last_seen, editing_member_id}}`` with TTL expiry so a
client that goes away without unsubscribing simply falls out of the roster.

Two interchangeable backends, chosen exactly like the event bus:

* **In-process** (default / ``REDIS_URL`` unset): a module-level dict.  Correct
  for single-worker deployments.
* **Redis** (``REDIS_URL`` set): one hash per tree (``presence:{tree_id}``) with
  a field per user, so every worker in the pool sees the same roster.  The whole
  key carries a TTL as a backstop that clears an abandoned tree entirely.

All coroutines run on the event loop.  Sync route handlers stay on the loop by
being declared ``async`` (their sync DB dependencies still run in the
threadpool), so these helpers are awaited directly — no cross-thread bridging.
Every operation degrades gracefully: a Redis failure is logged and swallowed so
presence can never take down the request path.
"""

from __future__ import annotations

import json
import logging
import time
from typing import TypedDict

logger = logging.getLogger(__name__)

# A client heartbeats about every 30 s; expire after two missed beats so a
# brief network hiccup does not make someone flicker out of the roster.
PRESENCE_TTL_SECONDS = 65

# Redis key prefix for the per-tree presence hash.
_KEY_PREFIX = "presence:"


def _key(tree_id: str) -> str:
    return f"{_KEY_PREFIX}{tree_id}"


class PresenceEntry(TypedDict):
    """One user's raw presence record (no display data resolved yet)."""

    user_id: str
    editing_member_id: str | None


class _PresenceRecord(TypedDict):
    """One user's raw bookkeeping record in the in-process store."""

    last_seen: float
    editing: str | None


# In-process store: tree_id -> user_id -> presence record.
# Only ever touched from the event-loop thread, so no lock is needed.
_store: dict[str, dict[str, _PresenceRecord]] = {}


def _now() -> float:
    return time.time()


# ---------------------------------------------------------------------------
# In-process backend
# ---------------------------------------------------------------------------


def _mem_touch(tree_id: str, user_id: str, editing_member_id: str | None) -> None:
    _store.setdefault(tree_id, {})[user_id] = {
        "last_seen": _now(),
        "editing": editing_member_id,
    }


def _mem_leave(tree_id: str, user_id: str) -> None:
    users = _store.get(tree_id)
    if users is None:
        return
    users.pop(user_id, None)
    if not users:
        _store.pop(tree_id, None)


def _mem_entries(tree_id: str) -> list[PresenceEntry]:
    users = _store.get(tree_id)
    if not users:
        return []
    cutoff = _now() - PRESENCE_TTL_SECONDS
    fresh: list[PresenceEntry] = []
    stale: list[str] = []
    for user_id, rec in users.items():
        if rec["last_seen"] < cutoff:
            stale.append(user_id)
            continue
        fresh.append({"user_id": user_id, "editing_member_id": rec["editing"]})
    for user_id in stale:
        users.pop(user_id, None)
    if not users:
        _store.pop(tree_id, None)
    return fresh


# ---------------------------------------------------------------------------
# Redis backend
# ---------------------------------------------------------------------------


async def _redis_touch(
    redis, tree_id: str, user_id: str, editing_member_id: str | None
) -> None:
    key = _key(tree_id)
    value = json.dumps({"last_seen": _now(), "editing": editing_member_id})
    await redis.hset(key, user_id, value)
    # Backstop TTL on the whole key so an abandoned tree clears itself; each
    # heartbeat refreshes it, so it only fires once everyone has left.
    await redis.expire(key, PRESENCE_TTL_SECONDS)


async def _redis_leave(redis, tree_id: str, user_id: str) -> None:
    await redis.hdel(_key(tree_id), user_id)


async def _redis_entries(redis, tree_id: str) -> list[PresenceEntry]:
    key = _key(tree_id)
    raw: dict[str, str] = await redis.hgetall(key)
    if not raw:
        return []
    cutoff = _now() - PRESENCE_TTL_SECONDS
    fresh: list[PresenceEntry] = []
    stale: list[str] = []
    for user_id, payload in raw.items():
        try:
            rec = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            stale.append(user_id)
            continue
        if float(rec.get("last_seen", 0)) < cutoff:
            stale.append(user_id)
            continue
        fresh.append({"user_id": user_id, "editing_member_id": rec.get("editing")})
    if stale:
        await redis.hdel(key, *stale)
    return fresh


# ---------------------------------------------------------------------------
# Public async API (awaited from the async presence route)
# ---------------------------------------------------------------------------


def reset() -> None:
    """Clear the in-process registry.

    Called from lifespan startup and shutdown so the module-level store never
    carries a roster over from a previous app instance in the same process
    (relevant for tests, which construct the FastAPI app more than once). The
    Redis backend needs no equivalent — its state lives in Redis, not here.
    """
    _store.clear()


async def touch(tree_id: str, user_id: str, editing_member_id: str | None) -> None:
    """Record/refresh *user_id*'s presence in *tree_id*.  Never raises."""
    from app.db.redis import get_redis  # local import to avoid circular deps

    redis = get_redis()
    if redis is None:
        _mem_touch(tree_id, user_id, editing_member_id)
        return
    try:
        await _redis_touch(redis, tree_id, user_id, editing_member_id)
    except Exception:
        logger.warning("presence touch failed for tree %r", tree_id, exc_info=True)


async def leave(tree_id: str, user_id: str) -> None:
    """Remove *user_id* from *tree_id*'s roster.  Never raises."""
    from app.db.redis import get_redis  # local import

    redis = get_redis()
    if redis is None:
        _mem_leave(tree_id, user_id)
        return
    try:
        await _redis_leave(redis, tree_id, user_id)
    except Exception:
        logger.warning("presence leave failed for tree %r", tree_id, exc_info=True)


async def active_entries(tree_id: str) -> list[PresenceEntry]:
    """Return the non-expired roster for *tree_id*, pruning stale entries.

    Returns an empty list (never raises) when Redis is unavailable or errors.
    """
    from app.db.redis import get_redis  # local import

    redis = get_redis()
    if redis is None:
        return _mem_entries(tree_id)
    try:
        return await _redis_entries(redis, tree_id)
    except Exception:
        logger.warning(
            "presence active_entries failed for tree %r", tree_id, exc_info=True
        )
        return []
