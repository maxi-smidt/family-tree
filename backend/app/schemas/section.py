"""Schemas for sections, section membership, and per-section layout (#982)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.extract import Direction


def _require_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Name is required")
    return value


class SectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    name: str
    position: int
    created_at: str
    member_count: int = 0
    # Per-section write capability (#1029): a section-scoped editor grant may
    # cover only some of a workspace's sections, so the coarse workspace role
    # alone can't tell the UI whether *this* section's rename/delete actions
    # are theirs to use. Defaults True for routes that already gate the
    # response behind a write check on this exact section.
    can_write: bool = True


class SectionCreate(BaseModel):
    name: str
    # Optional traversal seed reusing services/workspaces/subtree_selection.py:
    # when given, membership is seeded from the branch reachable from this
    # root member; when omitted, the section starts empty.
    root_member_id: str | None = None
    direction: Direction = "direct_family"

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return _require_name(value)


class SectionUpdate(BaseModel):
    name: str | None = None
    position: int | None = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str | None) -> str | None:
        return None if value is None else _require_name(value)


class SectionOverlap(BaseModel):
    """How many of a would-be section's boundary people already belong to
    an existing section — the connection the new section would form."""

    section_id: str
    section_name: str
    member_count: int


class SectionPreview(BaseModel):
    primary_member_ids: list[str]
    boundary_member_ids: list[str]
    overlaps: list[SectionOverlap]


class SectionMembersSet(BaseModel):
    member_ids: list[str]


class SectionPositionItem(BaseModel):
    member_id: str
    position_x: float
    position_y: float


class SectionSuggestion(BaseModel):
    """A section suggested for a member based on their parents'/partners'
    existing membership — surfaced for confirmation, never applied silently."""

    section: SectionOut
    matched_via_member_ids: list[str]
