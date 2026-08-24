"""Schema for the persistent notification inbox.

``Notification.payload`` (see ``app.models.notification``) is one JSON-encoded
``Text`` column shared by every notification ``type``; the payload shape it
holds depends on that type. Each shape below is its own small model, unioned
into ``NotificationPayload`` for ``NotificationOut.payload`` and for
``notification_service.create_notification``'s per-type overloads, so a
caller can't pass the wrong shape for a given type string and a bad payload
can't reach the ``Text`` column unvalidated.
"""

from pydantic import BaseModel


class InvitationReceivedPayload(BaseModel):
    workspace_id: str
    workspace_name: str


class WorkspaceUnsharedPayload(BaseModel):
    workspace_id: str
    workspace_name: str


class FriendRequestReceivedPayload(BaseModel):
    requester_id: str
    requester_username: str


class FriendRequestAcceptedPayload(BaseModel):
    addressee_id: str
    addressee_username: str


class WorkspaceSharedPayload(BaseModel):
    workspace_id: str
    workspace_name: str
    role: str
    actor_username: str


# Structurally overlapping members (e.g. InvitationReceivedPayload and
# WorkspaceUnsharedPayload both are {workspace_id, workspace_name}) still round-trip the
# same JSON either way pydantic's smart-union picks, since Pydantic favors
# the member that consumes every key with none discarded.
NotificationPayload = (
    InvitationReceivedPayload
    | WorkspaceUnsharedPayload
    | FriendRequestReceivedPayload
    | FriendRequestAcceptedPayload
    | WorkspaceSharedPayload
)


class NotificationOut(BaseModel):
    id: str
    type: str
    payload: NotificationPayload | None = None
    created_at: str
    read_at: str | None = None


class NotificationPageOut(BaseModel):
    """A bounded, newest-first page of notifications.

    ``total`` counts all of the user's notifications (for paging);
    ``unread_count`` is the total unread count, independent of the page.
    """

    entries: list[NotificationOut]
    total: int
    unread_count: int
