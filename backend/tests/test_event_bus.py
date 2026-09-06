"""Unit tests for EventBus — no running event loop needed; we call
_dispatch() directly and run async helpers via asyncio.run()."""

import asyncio

from app.services.event_bus import EventBus

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run(coro):  # type: ignore[no-untyped-def]
    """Run a coroutine synchronously (helper for tests)."""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_subscribe_returns_queue():
    bus = EventBus()

    async def _run():
        q = await bus.subscribe("user-1")
        assert q is not None
        return q

    q = run(_run())
    assert isinstance(q, asyncio.Queue)


def test_dispatch_fans_out_to_multiple_subscribers():
    bus = EventBus()
    event = {"type": "workspace.deleted", "data": {"workspace_id": "t1"}}

    async def _run():
        q1 = await bus.subscribe("user-1")
        q2 = await bus.subscribe("user-1")  # second subscriber for same user
        bus._dispatch(["user-1"], event)
        return q1, q2

    q1, q2 = run(_run())
    assert q1.get_nowait() == event
    assert q2.get_nowait() == event


def test_dispatch_targets_only_relevant_users():
    bus = EventBus()
    event = {"type": "workspace.deleted", "data": {"workspace_id": "t1"}}

    async def _run():
        q_target = await bus.subscribe("user-1")
        q_other = await bus.subscribe("user-2")
        bus._dispatch(["user-1"], event)
        return q_target, q_other

    q_target, q_other = run(_run())
    assert q_target.get_nowait() == event
    assert q_other.empty()


def test_unsubscribe_removes_queue():
    bus = EventBus()

    async def _run():
        q = await bus.subscribe("user-1")
        bus.unsubscribe("user-1", q)
        return q

    q = run(_run())
    # After unsubscribe the key should be gone
    assert "user-1" not in bus._subscribers
    # A dispatch to that user should silently do nothing
    bus._dispatch(["user-1"], {"type": "x", "data": {}})
    assert q.empty()


def test_unsubscribe_unknown_user_does_not_raise():
    bus = EventBus()
    fake_q: asyncio.Queue[dict] = asyncio.Queue()
    bus.unsubscribe("nobody", fake_q)  # should not raise


def test_full_queue_does_not_raise():
    bus = EventBus()

    async def _run():
        # maxsize=1 to make it easy to fill
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=1)
        bus._subscribers["user-1"].add(q)
        event = {"type": "t", "data": {}}
        # First put fills the queue
        bus._dispatch(["user-1"], event)
        # Second put would normally raise QueueFull — must be silently dropped
        bus._dispatch(["user-1"], event)
        return q

    q = run(_run())
    # Only the first event should be there; no exception was raised
    assert q.get_nowait() == {"type": "t", "data": {}}
    assert q.empty()


def test_publish_without_loop_does_not_raise():
    bus = EventBus()
    # _loop is None by default; publish must be a no-op
    bus.publish(["user-1"], "workspace.deleted", {"workspace_id": "t1"})
