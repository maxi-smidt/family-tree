"""In-process fan-out event bus for Server-Sent Events.

Routes that run in the threadpool (sync FastAPI handlers) call
``event_bus.publish(...)`` which is thread-safe.  The SSE endpoint
(async) subscribes via ``await event_bus.subscribe(user_id)``.
"""

import asyncio
import logging
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import TreeMembership
from app.models.tree import Tree
from app.models.user import User

logger = logging.getLogger(__name__)


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(
            set
        )
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Store the running event loop (called from lifespan startup)."""
        self._loop = loop

    async def subscribe(self, user_id: str) -> "asyncio.Queue[dict[str, Any]]":
        """Create a queue for *user_id* and register it.  Returns the queue."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        self._subscribers[user_id].add(queue)
        return queue

    def unsubscribe(
        self, user_id: str, queue: "asyncio.Queue[dict[str, Any]]"
    ) -> None:
        """Remove *queue* from the user's subscriber set."""
        queues = self._subscribers.get(user_id)
        if queues is None:
            return
        queues.discard(queue)
        if not queues:
            del self._subscribers[user_id]

    def publish(
        self, user_ids: Iterable[str], event_type: str, data: dict[str, Any]
    ) -> None:
        """Thread-safe entry point for sync route handlers.

        Schedules ``_dispatch`` on the event loop.  Safe to call from
        the threadpool that FastAPI uses for synchronous endpoints.
        """
        if self._loop is None:
            return
        event: dict[str, Any] = {"type": event_type, "data": data}
        self._loop.call_soon_threadsafe(self._dispatch, list(user_ids), event)

    def _dispatch(
        self, user_ids: list[str], event: dict[str, Any]
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
    data: dict[str, Any],
    extra_user_ids: Iterable[str] = (),
) -> None:
    """Compute the audience for *tree* and publish *event_type*.

    Never raises — any failure is logged and swallowed so it cannot
    propagate into the HTTP request path.
    """
    try:
        audience = tree_audience(db, tree) | set(extra_user_ids)
        event_bus.publish(audience, event_type, data)
    except Exception:
        logger.exception("publish_tree_event failed (event_type=%s)", event_type)
