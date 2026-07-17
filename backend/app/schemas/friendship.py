from __future__ import annotations

from pydantic import BaseModel


class FriendRequestCreate(BaseModel):
    username: str


class FriendOut(BaseModel):
    """A friend relationship from the current user's point of view.

    ``status`` is the relationship state; ``direction`` is "incoming" when the
    other user sent a still-pending request to me, "outgoing" when I sent it.
    """

    user_id: str
    username: str
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    # Present only for accepted friends. The URL is served by a friendship-
    # scoped, authenticated endpoint rather than the general media route.
    profile_image_url: str | None = None
    status: str
    direction: str
    created_at: str
    responded_at: str | None = None


class UserSearchResult(BaseModel):
    """A user matched by username search, annotated with our relationship.

    ``status`` is None when there is no existing friendship, so the UI can offer
    a "send request" action; otherwise it reflects the current state.
    ``direction`` is set only for ``pending`` ("incoming" when they requested me,
    "outgoing" when I requested them) so the UI can offer accept vs. revoke.
    """

    user_id: str
    username: str
    full_name: str | None = None
    status: str | None = None
    direction: str | None = None
