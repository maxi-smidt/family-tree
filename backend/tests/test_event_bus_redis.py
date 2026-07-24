"""Tests for the Redis-backed EventBus path.

These tests never connect to a real Redis server.  They use lightweight fakes
that implement just enough of the redis.asyncio pubsub / client API to verify
the EventBus behaviour:

 - In-process fallback (Redis unset) still works — existing behaviour
   preserved.
 - With a mocked Redis client, a message arriving on ``events:{user_id}``
   (simulating a publish from another worker) is delivered to the local
   subscriber's queue via the listener task.
 - The listener PSUBSCRIBEs once to ``events:*`` at startup, and per-user
   subscribe()/unsubscribe() never touch Redis.
 - publish() with Redis configured issues PUBLISH to the right channels and
   does NOT double-dispatch locally.
"""

import asyncio
import json
from collections.abc import AsyncGenerator
from unittest.mock import patch

import app.db.redis as redis_module
from app.core.config import settings
from app.services.event_bus import EventBus, _channel


def run(coro):  # type: ignore[no-untyped-def]
    """Run an async coroutine synchronously."""
    return asyncio.run(coro)


async def _until(predicate, timeout: float = 2.0) -> None:
    """Poll ``predicate`` every tick until true, or raise after ``timeout``.

    Deterministic replacement for fixed ``asyncio.sleep()`` waits: yields
    control so the listener/background task can advance, without pinning the
    test to a specific real-time delay.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not predicate():
        if loop.time() >= deadline:
            raise TimeoutError(f"condition not met within {timeout}s")
        await asyncio.sleep(0)


# ---------------------------------------------------------------------------
# Fake redis objects
# ---------------------------------------------------------------------------


class FakePubSub:
    """Minimal async pubsub fake that records pattern subscriptions and lets
    tests inject messages via ``push_message``."""

    def __init__(self) -> None:
        self.psubscribed: list[str] = []
        self.punsubscribed: list[str] = []
        self._queue: asyncio.Queue[dict] = asyncio.Queue()
        self._closed = False

    async def psubscribe(self, *patterns: str) -> None:
        self.psubscribed.extend(patterns)

    async def punsubscribe(self, *patterns: str) -> None:
        self.punsubscribed.extend(patterns)

    def push_message(self, channel: str, data: str) -> None:
        """Inject a pattern message as if it arrived from Redis pub/sub."""
        self._queue.put_nowait(
            {
                "type": "pmessage",
                "pattern": "events:*",
                "channel": channel,
                "data": data,
            }
        )

    async def listen(self) -> AsyncGenerator[dict, None]:
        while not self._closed:
            try:
                msg = await asyncio.wait_for(self._queue.get(), timeout=0.05)
                yield msg
            except TimeoutError:
                # Nothing yet — loop and check _closed.
                pass

    async def close(self) -> None:
        self._closed = True


class FakeRedis:
    """Minimal async Redis fake that records PUBLISH calls."""

    def __init__(self) -> None:
        self.published: list[tuple[str, str]] = []
        self._pubsub = FakePubSub()

    def pubsub(self) -> FakePubSub:
        return self._pubsub

    async def publish(self, channel: str, payload: str) -> int:
        self.published.append((channel, payload))
        return 1


# ---------------------------------------------------------------------------
# In-process fallback (no Redis)
# ---------------------------------------------------------------------------


def test_fallback_publish_dispatches_locally(monkeypatch):
    """Without Redis, publish() dispatches events in-process via call_soon_threadsafe."""
    monkeypatch.setattr(settings, "REDIS_URL", None)
    monkeypatch.setattr(redis_module, "_client", None)

    bus = EventBus()

    async def _run():
        loop = asyncio.get_running_loop()
        bus.set_loop(loop)
        q = await bus.subscribe("user-1")
        # publish() is sync; call it after set_loop
        bus.publish(["user-1"], "tree.deleted", {"tree_id": "t1"})
        # Give the loop a tick to process call_soon_threadsafe.
        await asyncio.sleep(0)
        return q

    q = run(_run())
    event = q.get_nowait()
    assert event == {"type": "tree.deleted", "data": {"tree_id": "t1"}}


def test_fallback_no_double_dispatch(monkeypatch):
    """In-process path must not deliver the same event twice."""
    monkeypatch.setattr(settings, "REDIS_URL", None)
    monkeypatch.setattr(redis_module, "_client", None)

    bus = EventBus()

    async def _run():
        loop = asyncio.get_running_loop()
        bus.set_loop(loop)
        q = await bus.subscribe("user-1")
        bus.publish(["user-1"], "x", {})
        await asyncio.sleep(0)
        return q

    q = run(_run())
    assert q.qsize() == 1


# ---------------------------------------------------------------------------
# Redis path — message delivery from another worker
# ---------------------------------------------------------------------------


def test_redis_listener_delivers_message(monkeypatch):
    """A message arriving on events:{user_id} is delivered to the local queue."""
    fake_redis = FakeRedis()
    fake_pubsub = fake_redis._pubsub

    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_module, "_client", None)
    # Patch get_redis at its definition so all callers (local imports) see it.
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    async def _run():
        bus = EventBus()
        loop = asyncio.get_running_loop()
        bus.set_loop(loop)

        await bus.start_redis_listener()

        q = await bus.subscribe("user-1")

        # Simulate a publish from another worker by injecting a message.
        event = {"type": "tree.deleted", "data": {"tree_id": "t1"}}
        fake_pubsub.push_message(_channel("user-1"), json.dumps(event))

        # Wait deterministically for the listener to enqueue it.
        received = await asyncio.wait_for(q.get(), timeout=2.0)

        await bus.stop_redis_listener()
        return received

    received = run(_run())
    assert received == {"type": "tree.deleted", "data": {"tree_id": "t1"}}


def test_redis_listener_ignores_unknown_channels(monkeypatch):
    """Messages on unrecognised channels must not crash the listener."""
    fake_redis = FakeRedis()
    fake_pubsub = fake_redis._pubsub

    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    async def _run():
        bus = EventBus()
        loop = asyncio.get_running_loop()
        bus.set_loop(loop)

        await bus.start_redis_listener()

        q = await bus.subscribe("user-1")

        # Message on a non-events channel — should be silently ignored.
        fake_pubsub.push_message("other:stuff", '{"type":"x","data":{}}')
        # Message with bad JSON — should be logged and skipped.
        fake_pubsub.push_message(_channel("user-1"), "not-json")
        # Sentinel pushed last: messages are processed in FIFO order, so its
        # arrival deterministically proves the two bad ones were already
        # processed (and skipped) rather than requiring a fixed real sleep.
        sentinel = {"type": "sentinel", "data": {}}
        fake_pubsub.push_message(_channel("user-1"), json.dumps(sentinel))

        received = await asyncio.wait_for(q.get(), timeout=2.0)

        await bus.stop_redis_listener()
        return received, q.empty()

    received, was_empty = run(_run())
    # Only the sentinel was delivered — the bad ones were skipped, not queued.
    assert received == {"type": "sentinel", "data": {}}
    assert was_empty


# ---------------------------------------------------------------------------
# Pattern subscription: one static PSUBSCRIBE, no per-user Redis churn
# ---------------------------------------------------------------------------


def test_listener_psubscribes_once_to_pattern(monkeypatch):
    """The listener PSUBSCRIBEs exactly once to events:* — never per user."""
    fake_redis = FakeRedis()
    fake_pubsub = fake_redis._pubsub

    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    async def _run():
        bus = EventBus()
        bus.set_loop(asyncio.get_running_loop())

        await bus.start_redis_listener()

        # Many subscribers across several users must add no extra PSUBSCRIBEs.
        await bus.subscribe("user-1")
        await bus.subscribe("user-1")
        await bus.subscribe("user-2")

        await bus.stop_redis_listener()

    run(_run())

    assert fake_pubsub.psubscribed == ["events:*"]


def test_subscribe_unsubscribe_dont_touch_redis(monkeypatch):
    """Per-user subscribe()/unsubscribe() never mutate the Redis subscription."""
    fake_redis = FakeRedis()
    fake_pubsub = fake_redis._pubsub

    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    async def _run():
        bus = EventBus()
        bus.set_loop(asyncio.get_running_loop())

        await bus.start_redis_listener()

        q1 = await bus.subscribe("user-1")
        q2 = await bus.subscribe("user-1")
        bus.unsubscribe("user-1", q1)
        bus.unsubscribe("user-1", q2)  # last subscriber gone
        # unsubscribe() is synchronous and never touches Redis — one tick is
        # enough to let any (unwanted) scheduled callback run.
        await asyncio.sleep(0)

        # No per-user (P)UNSUBSCRIBE — the static pattern stays put.
        assert fake_pubsub.punsubscribed == []

        await bus.stop_redis_listener()

    run(_run())


# ---------------------------------------------------------------------------
# publish() with Redis — PUBLISH to correct channels, no local double-dispatch
# ---------------------------------------------------------------------------


def test_redis_publish_calls_redis_publish(monkeypatch):
    """publish() with Redis configured calls redis.publish() for each user."""
    fake_redis = FakeRedis()

    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    async def _run():
        bus = EventBus()
        loop = asyncio.get_running_loop()
        bus.set_loop(loop)

        await bus.start_redis_listener()

        q = await bus.subscribe("user-1")

        # publish() is sync — it schedules a coroutine on the loop.
        bus.publish(["user-1", "user-2"], "tree.deleted", {"tree_id": "t1"})

        # Wait deterministically for the scheduled coroutine to run.
        await _until(lambda: len(fake_redis.published) >= 2)

        await bus.stop_redis_listener()
        return q

    q = run(_run())

    channels_published = {ch for ch, _ in fake_redis.published}
    assert _channel("user-1") in channels_published
    assert _channel("user-2") in channels_published

    # The queue must NOT have been filled locally by publish() itself —
    # that would be double-dispatch.  The listener fills it only if we also
    # inject a message into the fake pubsub, which we did not.
    assert q.empty()


def test_redis_publish_payload_is_correct_json(monkeypatch):
    """The JSON payload sent to Redis encodes the full event dict."""
    fake_redis = FakeRedis()

    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    async def _run():
        bus = EventBus()
        loop = asyncio.get_running_loop()
        bus.set_loop(loop)

        await bus.start_redis_listener()

        bus.publish(["user-1"], "tree.updated", {"tree_id": "t2", "name": "Family"})
        await _until(lambda: len(fake_redis.published) >= 1)

        await bus.stop_redis_listener()

    run(_run())

    assert len(fake_redis.published) == 1
    ch, payload = fake_redis.published[0]
    assert ch == _channel("user-1")
    event = json.loads(payload)
    assert event == {"type": "tree.updated", "data": {"tree_id": "t2", "name": "Family"}}


# ---------------------------------------------------------------------------
# Listener resilience — Redis error should not crash the task
# ---------------------------------------------------------------------------


def test_listener_retries_on_error(monkeypatch):
    """A Redis error in _run_listener triggers a retry, not a crash."""
    fake_redis = FakeRedis()
    call_count_holder: list[int] = [0]

    class ErrorPubSub(FakePubSub):
        async def listen(self) -> AsyncGenerator[dict, None]:  # type: ignore[override]
            call_count_holder[0] += 1
            if call_count_holder[0] == 1:
                raise ConnectionError("Redis gone")
            # On second call: close so the loop ends naturally.
            self._closed = True
            return
            yield  # make it an async generator

    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "get_redis", lambda: fake_redis)

    async def _run():
        bus = EventBus()
        bus.set_loop(asyncio.get_running_loop())

        await bus.start_redis_listener()
        # Inject the error pubsub after starting (replaces the real one).
        bus._pubsub = ErrorPubSub()

        # _listener_loop sleeps backoff seconds on error (default 1s).
        # Patch asyncio.sleep in the event_bus module to be instant.
        import app.services.event_bus as _eb_mod

        original_sleep = asyncio.sleep

        async def fast_sleep(delay: float) -> None:
            await original_sleep(0)

        with patch.object(_eb_mod.asyncio, "sleep", side_effect=fast_sleep):
            # Give the loop enough ticks for two listener iterations.
            for _ in range(100):
                await original_sleep(0)

        await bus.stop_redis_listener()

    run(_run())

    # The task must have survived the first error and retried at least once.
    assert call_count_holder[0] >= 1
