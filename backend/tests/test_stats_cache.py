"""Tests for the Redis caching layer on the statistics endpoint.

Redis is external and optional.  These tests never connect to a real Redis
instance — they use a lightweight fake (``FakeRedis``) that records GET/SET/DEL
calls so we can assert caching behaviour without network I/O.

Scenarios covered:

1. With Redis: a repeat statistics request is served from cache (DB members
   query not re-executed a second time).
2. With Redis: creating a member busts the stats key, so the next request
   recomputes (and re-populates the cache).
3. Without Redis: statistics are always recomputed (current behaviour preserved).
4. Cache error (Redis raises): endpoint degrades to recompute — never 500.
5. Corrupt cached value: falls through and recomputes silently.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import app.db.redis as redis_module
from tests.conftest import API, auth, make_tree, make_user

# ---------------------------------------------------------------------------
# Fake Redis
# ---------------------------------------------------------------------------


class FakeRedis:
    """Minimal async Redis fake that records SET/GET/DEL operations."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}
        self.get_calls: list[str] = []
        self.set_calls: list[tuple[str, str]] = []
        self.del_calls: list[tuple[str, ...]] = []

    async def get(self, key: str) -> str | None:
        self.get_calls.append(key)
        return self._store.get(key)

    async def set(self, key: str, value: str, *, ex: int | None = None) -> None:
        self.set_calls.append((key, value))
        self._store[key] = value

    async def delete(self, *keys: str) -> int:
        self.del_calls.append(keys)
        count = 0
        for k in keys:
            if k in self._store:
                del self._store[k]
                count += 1
        return count


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _stats_url(workspace_id: str) -> str:
    return f"{API}/workspaces/{workspace_id}/statistics"


def _create_member(client, tree, user, member_id: str = "m1") -> None:
    resp = client.post(
        f"{API}/workspaces/{tree.id}/members",
        headers=auth(user),
        json={"id": member_id, "firstName": "Ada", "lastName": "Lovelace", "gender": "f"},
    )
    assert resp.status_code == 201, resp.text


# ---------------------------------------------------------------------------
# Test: cache hit avoids re-computation
# ---------------------------------------------------------------------------


def test_statistics_cache_hit_served_from_cache(client, db, monkeypatch):
    """A repeat GET /statistics request is served from cache.

    The fake Redis is pre-seeded with a valid serialised StatisticsReport so
    the second request returns it directly without touching the DB.
    """
    fake_redis = FakeRedis()
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    user = make_user(db)
    tree = make_tree(db, user)

    # First request — cache miss, computes from DB (empty tree → 0 members).
    resp1 = client.get(_stats_url(tree.id), headers=auth(user))
    assert resp1.status_code == 200
    body1 = resp1.json()
    assert body1["total_members"] == 0

    # After the first request the cache should have been populated.
    assert len(fake_redis.set_calls) == 1
    key_written, value_written = fake_redis.set_calls[0]
    assert key_written == f"cache:stats:{tree.id}"

    # Tamper with the cache value so we can tell if the second request uses it.
    tampered: dict[str, Any] = json.loads(value_written)
    tampered["total_members"] = 999
    fake_redis._store[key_written] = json.dumps(tampered)

    # Second request — should come from cache (returns 999).
    resp2 = client.get(_stats_url(tree.id), headers=auth(user))
    assert resp2.status_code == 200
    assert resp2.json()["total_members"] == 999


# ---------------------------------------------------------------------------
# Test: write invalidates the cache
# ---------------------------------------------------------------------------


def test_member_create_busts_stats_cache(client, db, monkeypatch):
    """Creating a member invalidates the stats cache key.

    After invalidation, the next GET /statistics recomputes from the DB.
    """
    fake_redis = FakeRedis()
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    # Register a loop in the runtime holder so invalidate_stats can schedule
    # the async delete.
    from app.core import runtime

    loop = asyncio.new_event_loop()
    original_loop = runtime.get_loop()
    runtime.set_loop(loop)
    try:
        # First stats request — populates cache.
        user = make_user(db)
        tree = make_tree(db, user)

        resp1 = client.get(_stats_url(tree.id), headers=auth(user))
        assert resp1.status_code == 200
        assert resp1.json()["total_members"] == 0
        assert len(fake_redis.set_calls) == 1

        # Seed cache with tampered value so we know if cache is used.
        stats_key = f"cache:stats:{tree.id}"
        tampered = json.loads(fake_redis.set_calls[0][1])
        tampered["total_members"] = 999
        fake_redis._store[stats_key] = json.dumps(tampered)

        # Create a member — should schedule cache invalidation.
        _create_member(client, tree, user, "m1")

        # Drain the scheduled coroutine — run_coroutine_threadsafe schedules it
        # on `loop`; we run the loop briefly to let it execute.
        loop.run_until_complete(asyncio.sleep(0))

        # The cache key should have been deleted.
        assert len(fake_redis.del_calls) >= 1
        deleted_keys = {k for args in fake_redis.del_calls for k in args}
        assert stats_key in deleted_keys

        # Next stats request recomputes from DB — now sees 1 member.
        resp2 = client.get(_stats_url(tree.id), headers=auth(user))
        assert resp2.status_code == 200
        assert resp2.json()["total_members"] == 1
    finally:
        runtime.set_loop(original_loop)
        loop.close()


# ---------------------------------------------------------------------------
# Test: without Redis — always recomputes (current behaviour preserved)
# ---------------------------------------------------------------------------


def test_statistics_no_redis_always_recomputes(client, db, monkeypatch):
    """When Redis is not configured every request recomputes from the DB."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "REDIS_URL", None)
    monkeypatch.setattr(redis_module, "_client", None)
    # Ensure get_redis returns None (default when REDIS_URL unset).
    monkeypatch.setattr(redis_module, "get_redis", lambda: None)

    user = make_user(db)
    tree = make_tree(db, user)

    resp1 = client.get(_stats_url(tree.id), headers=auth(user))
    assert resp1.status_code == 200
    assert resp1.json()["total_members"] == 0

    _create_member(client, tree, user, "m1")

    resp2 = client.get(_stats_url(tree.id), headers=auth(user))
    assert resp2.status_code == 200
    # Without cache every request reads the DB; should see the new member.
    assert resp2.json()["total_members"] == 1


# ---------------------------------------------------------------------------
# Test: Redis error degrades gracefully (no 500)
# ---------------------------------------------------------------------------


def test_statistics_redis_error_degrades_gracefully(client, db, monkeypatch):
    """A Redis error on GET must not propagate — endpoint returns 200."""

    class ErrorRedis(FakeRedis):
        async def get(self, key: str) -> str | None:
            raise ConnectionError("Redis down")

        async def set(self, key: str, value: str, *, ex: int | None = None) -> None:
            raise ConnectionError("Redis down")

    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: ErrorRedis())

    user = make_user(db)
    tree = make_tree(db, user)

    resp = client.get(_stats_url(tree.id), headers=auth(user))
    assert resp.status_code == 200
    # Even with Redis broken the endpoint computes and returns the report.
    assert resp.json()["total_members"] == 0


# ---------------------------------------------------------------------------
# Test: corrupt cached value falls through to recompute
# ---------------------------------------------------------------------------


def test_statistics_corrupt_cache_falls_through(client, db, monkeypatch):
    """If the cached value cannot be validated, the endpoint recomputes."""
    fake_redis = FakeRedis()
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    user = make_user(db)
    tree = make_tree(db, user)

    # Pre-seed cache with invalid data.
    stats_key = f"cache:stats:{tree.id}"
    fake_redis._store[stats_key] = json.dumps({"bad": "data"})

    # Should still return a valid response (recomputed from DB).
    resp = client.get(_stats_url(tree.id), headers=auth(user))
    assert resp.status_code == 200
    assert "total_members" in resp.json()


# ---------------------------------------------------------------------------
# Test: delete member also busts cache
# ---------------------------------------------------------------------------


def test_member_delete_busts_stats_cache(client, db, monkeypatch):
    """Deleting a member also schedules a stats cache invalidation."""
    fake_redis = FakeRedis()
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    from app.core import runtime

    loop = asyncio.new_event_loop()
    original_loop = runtime.get_loop()
    runtime.set_loop(loop)
    try:
        user = make_user(db)
        tree = make_tree(db, user)
        _create_member(client, tree, user, "m1")

        # Drain any pending coroutines from create.
        loop.run_until_complete(asyncio.sleep(0))
        fake_redis.del_calls.clear()

        # Delete the member — should also invalidate cache.
        resp = client.delete(f"{API}/workspaces/{tree.id}/members/m1", headers=auth(user))
        assert resp.status_code == 204

        loop.run_until_complete(asyncio.sleep(0))

        stats_key = f"cache:stats:{tree.id}"
        deleted_keys = {k for args in fake_redis.del_calls for k in args}
        assert stats_key in deleted_keys
    finally:
        runtime.set_loop(original_loop)
        loop.close()
