"""Schema for the persistent notification inbox."""

from typing import Any

from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: str
    type: str
    payload: dict[str, Any] | None = None
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
