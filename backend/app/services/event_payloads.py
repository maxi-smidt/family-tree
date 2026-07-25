"""Typed payload shapes for SSE events published via ``EventBus``.

Each ``TypedDict`` mirrors the ``data`` shape a frontend
``eventSource.addEventListener(...)`` listener parses for that event type
(see ``frontend/src/services/realtime.ts``, the source of truth this module
is kept in sync with). They are plain ``dict``s at runtime — JSON-serialized
for Redis pub/sub or queued directly in-process, unchanged either way.

``EventPayload`` still includes a ``dict[str, Any]`` fallback member: not
every event type ``EventBus`` publishes has a typed variant here yet (this is
being migrated incrementally, by event-type group — see the SSE/event-bus
typing sub-issue of #774/#823). Remove the fallback once every event type
published anywhere in the backend has a variant below.
"""

from typing import Any, NotRequired, TypedDict


class ActivityEntryAddedData(TypedDict):
    tree_id: str


class TreeContentChangedData(TypedDict):
    """``domain`` selects which frontend store re-fetches (see
    ``domainRefreshers`` in ``realtime.ts``): member, event, story, task,
    document, or gallery."""

    tree_id: str
    domain: str
    actor_user_id: NotRequired[str]


class TreeAccessChangedData(TypedDict):
    tree_id: str


class TreeDeletedData(TypedDict):
    tree_id: str


class TreeOwnershipChangedData(TypedDict):
    tree_id: str
    new_owner_id: str


class TreeLayoutChangedData(TypedDict):
    tree_id: str
    actor_user_id: NotRequired[str]


EventPayload = (
    ActivityEntryAddedData
    | TreeContentChangedData
    | TreeAccessChangedData
    | TreeDeletedData
    | TreeOwnershipChangedData
    | TreeLayoutChangedData
    | dict[str, Any]
)
"""Every payload shape ``EventBus``/``publish_tree_event`` accepts.

The bare ``dict[str, Any]`` member is a transitional fallback for event
types not yet migrated to a typed variant above.
"""


class SSEEnvelope(TypedDict):
    """The ``{"type": ..., "data": ...}`` wrapper queued per subscriber and
    (when Redis is configured) JSON-serialized over per-user pub/sub
    channels — see ``EventBus._dispatch`` and ``routes/sse.py``."""

    type: str
    data: EventPayload
