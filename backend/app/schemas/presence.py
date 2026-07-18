"""Schemas for live-collaboration presence.

Deliberately snake_case (plain ``BaseModel``, not the camelCasing base): the
same shape is emitted both as the heartbeat HTTP response and as the
``presence.updated`` SSE payload, so the frontend has a single mapper.
"""

from pydantic import BaseModel


class PresenceHeartbeat(BaseModel):
    """Client → server heartbeat body."""

    # The member whose sheet this client currently has open in edit mode, if
    # any.  ``None`` means the client is only viewing the tree.
    editing_member_id: str | None = None


class PresenceUser(BaseModel):
    """One active user in a tree's roster.

    ``first_name`` / ``last_name`` let the shared account avatar render initials
    consistently. Profile *images* are deliberately not exposed here: they are
    self-only (see ``auth`` routes), so a client can only ever show its own.
    """

    user_id: str
    display_name: str
    first_name: str | None = None
    last_name: str | None = None
    editing_member_id: str | None = None


class PresenceRoster(BaseModel):
    """The full set of users currently active in a tree."""

    tree_id: str
    users: list[PresenceUser]
