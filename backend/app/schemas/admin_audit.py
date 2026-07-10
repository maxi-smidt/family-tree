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
