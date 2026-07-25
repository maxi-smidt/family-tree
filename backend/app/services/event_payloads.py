"""Typed payload shapes for SSE events published via ``EventBus``.

Each ``TypedDict`` mirrors the ``data`` shape a frontend
``eventSource.addEventListener(...)`` listener parses for that event type
(see ``frontend/src/services/realtime.ts``, the source of truth this module
is kept in sync with). They are plain ``dict``s at runtime — JSON-serialized
for Redis pub/sub or queued directly in-process, unchanged either way.

Every event type published anywhere in the backend has a variant below, so
``EventPayload`` has no ``dict[str, Any]`` fallback member.
"""

from typing import Literal, NotRequired, TypedDict


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


class JobProgressData(TypedDict):
    job_id: str
    pct: int


class JobDoneData(TypedDict):
    job_id: str
    tree_id: str


class JobFailedData(TypedDict):
    job_id: str
    error: str


class NotificationCreatedData(TypedDict):
    """Mirrors ``schemas.notification.NotificationOut`` — see
    ``notification_service._serialize``. ``payload``'s shape depends on
    ``type`` (see ``NotificationPayload``); it isn't re-validated at this
    JSON-decode boundary."""

    id: str
    type: str
    payload: dict[str, object] | None
    created_at: str
    read_at: str | None


class PresenceUserSnapshot(TypedDict):
    """Mirrors ``schemas.presence.PresenceUser``."""

    user_id: str
    display_name: str
    first_name: str | None
    last_name: str | None
    editing_member_id: str | None


class PresenceUpdatedData(TypedDict):
    tree_id: str
    users: list[PresenceUserSnapshot]


class StorageWarningData(TypedDict):
    """Mirrors ``storage_usage.MediaQuotaWarning`` — kept as a separate
    TypedDict here (rather than imported) so this module has no dependency
    on ``storage_usage``; the two are structurally identical by
    construction."""

    tree_id: str
    used_bytes: int
    quota_bytes: int


class BackupCompletedData(TypedDict):
    trigger: str
    filename: str | None


class PurgeRanData(TypedDict):
    purged_count: int


class SessionInvalidateData(TypedDict):
    reason: Literal["deactivated", "pending_deletion"]


class FriendRequestReceivedData(TypedDict):
    requester_id: str
    requester_username: str


class InvitationReceivedData(TypedDict):
    tree_id: str
    tree_name: str


EventPayload = (
    ActivityEntryAddedData
    | TreeContentChangedData
    | TreeAccessChangedData
    | TreeDeletedData
    | TreeOwnershipChangedData
    | TreeLayoutChangedData
    | JobProgressData
    | JobDoneData
    | JobFailedData
    | NotificationCreatedData
    | PresenceUpdatedData
    | StorageWarningData
    | BackupCompletedData
    | PurgeRanData
    | SessionInvalidateData
    | FriendRequestReceivedData
    | InvitationReceivedData
)
"""Every payload shape ``EventBus``/``publish_tree_event`` accepts — one
variant per event-type string published anywhere in the backend."""


class SSEEnvelope(TypedDict):
    """The ``{"type": ..., "data": ...}`` wrapper queued per subscriber and
    (when Redis is configured) JSON-serialized over per-user pub/sub
    channels — see ``EventBus._dispatch`` and ``routes/sse.py``."""

    type: str
    data: EventPayload
