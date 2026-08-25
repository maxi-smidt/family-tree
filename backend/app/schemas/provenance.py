"""Schemas for content provenance and re-scoping (#1023)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.models import ContentType


class ContentScopeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    content_type: str
    content_id: str
    workspace_id: str
    # null = workspace-wide origin.
    section_id: str | None
    created_at: str


class ContentScopeRef(BaseModel):
    content_type: ContentType
    content_id: str


class RescopeRequest(BaseModel):
    items: list[ContentScopeRef]
    # null moves the records to workspace-wide origin, the widest audience —
    # which is why the whole request is owner-only.
    section_id: str | None = None


class RescopeChange(BaseModel):
    content_type: str
    content_id: str
    from_section_id: str | None
    to_section_id: str | None
    audience_before: list[str]
    audience_after: list[str]
    widens: bool


class RescopePreview(BaseModel):
    changes: list[RescopeChange]


class SectionDependents(BaseModel):
    """What a section still holds, shown before it is deleted.

    Deleting a section must never turn its content into workspace-wide
    content, so scoped content blocks the delete until it is explicitly
    reassigned or removed.
    """

    section_id: str
    member_count: int
    content_scope_counts: dict[str, int]
