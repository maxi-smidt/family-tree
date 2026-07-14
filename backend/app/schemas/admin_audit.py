"""Schemas for instance-wide administrator audit entries."""

from pydantic import BaseModel, ConfigDict


class AdminAuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    actor_id: str | None = None
    actor_username: str | None = None
    action: str
    subject_type: str
    subject_id: str | None = None
    subject_label: str | None = None
    details: dict | None = None
    created_at: str


class AdminAuditPage(BaseModel):
    """A page of audit entries plus the total matching the active filters.

    ``total`` counts every row the filters match, not just the returned page,
    so the UI can paginate through the whole trail instead of only the newest
    entries.
    """

    items: list[AdminAuditOut]
    total: int
    limit: int
    offset: int
