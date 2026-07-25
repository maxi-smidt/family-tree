"""In-process fan-out event bus for Server-Sent Events.

Routes that run in the threadpool (sync FastAPI handlers) call
``event_bus.publish(...)`` which is thread-safe.  The SSE endpoint
(async) subscribes via ``await event_bus.subscribe(user_id)``.

When ``REDIS_URL`` is configured, published events are written to per-user
Redis pub/sub channels (``events:{user_id}``) so any worker in the pool
receives them.  A background listener task (started by the lifespan) holds a
single pattern subscription (``PSUBSCRIBE events:*``) and feeds each message
into the local asyncio queues for the user it targets — exactly as the
in-process path does today.  A worker only keeps queues for its own connected
clients, so events for users it isn't serving are received and dropped cheaply
in ``_dispatch``.  One static pattern subscription means the listener never
mutates its subscription set at runtime, so there is no concurrent access to
the pub/sub connection (which ``.listen()`` blocks on).

When ``REDIS_URL`` is *not* configured the behaviour is identical to the
original single-worker implementation: no Redis connection is attempted,
events are dispatched in-process via ``call_soon_threadsafe``.
"""

import asyncio
import json
import logging
from collections import defaultdict
from collections.abc import Iterable
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import TreeMembership
from app.models.tree import Tree
from app.models.user import User
from app.services.event_payloads import EventPayload, SSEEnvelope

logger = logging.getLogger(__name__)

# Prefix for per-user Redis pub/sub channels (channel == prefix + user_id).
_CHANNEL_PREFIX = "events:"

# Glob pattern the listener PSUBSCRIBEs to — matches every per-user channel.
_CHANNEL_PATTERN = f"{_CHANNEL_PREFIX}*"

# Events that represent a real tree mutation and should briefly highlight the
# actor's presence avatar on every active collaborator's canvas.
_PRESENCE_ACTIVITY_EVENTS = {"tree.content_changed", "tree.layout_changed"}


def _channel(user_id: str) -> str:
    return f"{_CHANNEL_PREFIX}{user_id}"


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[SSEEnvelope]]] = defaultdict(
            set
        )
        self._loop: asyncio.AbstractEventLoop | None = None

        # The single shared pubsub object used by the listener task. It holds
        # one static pattern subscription, so it is only ever touched by the
        # listener — never mutated per-user at runtime.
        self._pubsub: Any = None  # redis.asyncio.client.PubSub | None

        # Background listener task handle.
        self._listener_task: asyncio.Task[None] | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Store the running event loop (called from lifespan startup)."""
        self._loop = loop

    # ------------------------------------------------------------------
    # Subscribe / unsubscribe (async, runs on the event loop thread)
    # ------------------------------------------------------------------

    async def subscribe(self, user_id: str) -> "asyncio.Queue[SSEEnvelope]":
        """Create a queue for *user_id* and register it.  Returns the queue.

        No Redis interaction here: the listener holds a single static pattern
        subscription, so a new local subscriber just needs a local queue.
        """
        queue: asyncio.Queue[SSEEnvelope] = asyncio.Queue(maxsize=100)
        self._subscribers[user_id].add(queue)
        return queue

    def unsubscribe(
        self, user_id: str, queue: "asyncio.Queue[SSEEnvelope]"
    ) -> None:
        """Remove *queue* from the user's subscriber set.

        Purely local — the listener's pattern subscription is never mutated.
        """
        queues = self._subscribers.get(user_id)
        if queues is None:
            return
        queues.discard(queue)
        if not queues:
            del self._subscribers[user_id]

    # ------------------------------------------------------------------
    # Publish (sync, called from threadpool)
    # ------------------------------------------------------------------

    def publish(
        self, user_ids: Iterable[str], event_type: str, data: EventPayload
    ) -> None:
        """Thread-safe entry point for sync route handlers.

        When Redis is configured, PUBLISH the event to each per-user channel.
        The background listener task will pick it up (on this worker and any
        other workers in the pool) and call ``_dispatch`` to feed local queues.

        When Redis is *not* configured, schedule ``_dispatch`` directly on the
        event loop (original single-worker behaviour).
        """
        if self._loop is None:
            return

        from app.db.redis import get_redis  # local import

        event: SSEEnvelope = {"type": event_type, "data": data}
        user_id_list = list(user_ids)

        redis = get_redis()
        if redis is not None:
            # Dispatch async PUBLISH calls without blocking the threadpool.
            async def _publish_all() -> None:
                payload = json.dumps(event)
                for uid in user_id_list:
                    try:
                        await redis.publish(_channel(uid), payload)
                    except Exception:
                        logger.exception(
                            "Redis PUBLISH failed for user %s (event_type=%s)",
                            uid,
                            event_type,
                        )

            asyncio.run_coroutine_threadsafe(_publish_all(), self._loop)
            # Do NOT also call _dispatch locally — the listener task is what
            # feeds the local queues when Redis is configured.  Double-calling
            # would deliver every event twice to subscribers on this worker.
        else:
            # In-process path (single-worker / no Redis).
            self._loop.call_soon_threadsafe(self._dispatch, user_id_list, event)

    # ------------------------------------------------------------------
    # Internal dispatch (always runs on the event-loop thread)
    # ------------------------------------------------------------------

    def _dispatch(
        self, user_ids: list[str], event: SSEEnvelope
    ) -> None:
        """Runs on the event-loop thread; never blocks."""
        for user_id in user_ids:
            queues = self._subscribers.get(user_id)
            if not queues:
                continue
            for q in list(queues):
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    # Drop the event rather than blocking or raising.
                    pass

    # ------------------------------------------------------------------
    # Redis listener lifecycle
    # ------------------------------------------------------------------

    async def start_redis_listener(self) -> None:
        """Start the background pub/sub listener task.

        Should be called from lifespan startup when Redis is configured.
        Creates a dedicated pubsub object and PSUBSCRIBEs once to the
        ``events:*`` pattern — covering every per-user channel without any
        per-user subscription bookkeeping.
        """
        from app.db.redis import get_redis  # local import

        redis = get_redis()
        if redis is None:
            return

        try:
            self._pubsub = redis.pubsub()
            await self._pubsub.psubscribe(_CHANNEL_PATTERN)
        except Exception:
            logger.exception("Failed to start Redis pattern subscription")
            self._pubsub = None
            return

        self._listener_task = asyncio.create_task(
            self._listener_loop(), name="redis-sse-listener"
        )
        logger.info("Redis SSE listener task started")

    async def stop_redis_listener(self) -> None:
        """Cancel and await the background listener task.

        Should be called from lifespan shutdown before ``close_redis()``.
        """
        if self._listener_task is not None:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
            self._listener_task = None

        if self._pubsub is not None:
            try:
                await self._pubsub.close()
            except Exception:
                logger.exception("Error closing Redis pubsub")
            self._pubsub = None

        logger.info("Redis SSE listener task stopped")

    async def _listener_loop(self) -> None:
        """Receive messages from Redis and dispatch them to local queues.

        Runs indefinitely until cancelled.  On Redis errors it logs and
        retries with exponential back-off so a transient Redis restart does
        not crash the app.
        """
        backoff = 1.0
        while True:
            try:
                await self._run_listener()
            except asyncio.CancelledError:
                raise  # propagate cancellation — do not retry
            except Exception:
                logger.exception(
                    "Redis SSE listener error — retrying in %.1fs", backoff
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
            else:
                # _run_listener returned normally (shouldn't happen); retry.
                await asyncio.sleep(backoff)

    async def _run_listener(self) -> None:
        """Inner loop: iterate over messages from the pubsub object."""
        if self._pubsub is None:
            return

        async for raw in self._pubsub.listen():
            # raw is a dict: {"type": ..., "channel": ..., "data": ...}
            if raw is None:
                continue
            msg_type = raw.get("type")
            if msg_type != "pmessage":
                # "psubscribe" / "punsubscribe" confirmations — skip.
                continue

            channel: str = raw.get("channel", "")
            payload: str = raw.get("data", "")

            # Derive the user_id from the channel name "events:{user_id}".
            if not channel.startswith(_CHANNEL_PREFIX):
                continue
            user_id = channel[len(_CHANNEL_PREFIX):]

            try:
                event: SSEEnvelope = json.loads(payload)
            except (json.JSONDecodeError, TypeError):
                logger.warning(
                    "Redis listener: could not parse payload on %s: %r",
                    channel,
                    payload,
                )
                continue

            # Feed local queues (same as the in-process _dispatch path).
            self._dispatch([user_id], event)


# Module-level singleton
event_bus = EventBus()


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------


def admin_user_ids(db: Session) -> list[str]:
    """Return the IDs of all active admin users."""
    return list(
        db.scalars(
            select(User.id).where(
                User.is_admin.is_(True),
                User.is_active.is_(True),
                User.deletion_requested_at.is_(None),
            )
        ).all()
    )


def tree_audience(db: Session, tree: Tree) -> set[str]:
    """Return the set of user IDs that have access to *tree*.

    Includes the owner plus every TreeMembership row.
    """
    member_ids = set(
        db.scalars(
            select(TreeMembership.user_id).where(TreeMembership.tree_id == tree.id)
        ).all()
    )
    member_ids.add(tree.owner_id)
    return member_ids


def publish_tree_event(
    db: Session,
    tree: Tree,
    event_type: str,
    data: EventPayload,
    extra_user_ids: Iterable[str] = (),
) -> None:
    """Compute the audience for *tree* and publish *event_type*.

    Never raises — any failure is logged and swallowed so it cannot
    propagate into the HTTP request path.
    """
    try:
        audience = tree_audience(db, tree) | set(extra_user_ids)
        actor_id = db.info.get("tree_event_actor_id")
        event_data: EventPayload = data
        if event_type in _PRESENCE_ACTIVITY_EVENTS and isinstance(actor_id, str):
            # Both members of _PRESENCE_ACTIVITY_EVENTS declare actor_user_id
            # as NotRequired, so this merge always produces a valid member of
            # EventPayload — mypy just can't see that through **-unpacking.
            event_data = cast(EventPayload, {**data, "actor_user_id": actor_id})
        event_bus.publish(audience, event_type, event_data)
    except Exception:
        logger.exception("publish_tree_event failed (event_type=%s)", event_type)
