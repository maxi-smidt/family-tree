"""Schema for activity-log entries."""

from pydantic import BaseModel, ConfigDict


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tree_id: str
    actor_id: str | None = None
    actor_username: str | None = None
    action: str
    target_type: str
    target_id: str | None = None
    target_label: str | None = None
    created_at: str
    details: str | None = None


class ActivityPageOut(BaseModel):
    """A bounded, newest-first page of activity entries.

    ``total`` counts the entries matching the current filters (for paging);
    ``actors`` lists the distinct actor usernames for the filter dropdown.
    """

    entries: list[ActivityOut]
    total: int
    actors: list[str]
