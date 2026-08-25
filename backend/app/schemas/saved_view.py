"""Schemas for saved views: config CRUD, layout overlay, and per-user state."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator


def _require_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Name is required")
    return value


class SavedViewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    workspace_id: str
    owner_id: str
    name: str
    # ``None`` for either "no focus chosen yet" or "the focus member was
    # deleted" (#986: a degraded view exposes no cached metadata, just the
    # absence of a value) — the two are indistinguishable by design.
    focus_member_id: str | None
    section_ids: list[str]
    ancestor_depth: int
    descendant_depth: int
    include_partners: bool
    filters: dict
    config_version: int
    version: int
    created_at: str
    updated_at: str
    last_opened: str | None = None


class SavedViewCreate(BaseModel):
    name: str
    focus_member_id: str | None = None
    section_ids: list[str] = []
    ancestor_depth: int = 3
    descendant_depth: int = 3
    include_partners: bool = True
    filters: dict = {}

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return _require_name(value)

    @field_validator("ancestor_depth", "descendant_depth")
    @classmethod
    def _validate_depth(cls, value: int) -> int:
        if value < 0 or value > 20:
            raise ValueError("Depth must be between 0 and 20")
        return value


class SavedViewUpdate(BaseModel):
    # Every field is optional and, when given, replaces the prior value —
    # there is no per-field "unset" sentinel, so a client always sends the
    # full config that field belongs to (e.g. the whole ``section_ids`` list).
    name: str | None = None
    focus_member_id: str | None = None
    clear_focus_member: bool = False
    section_ids: list[str] | None = None
    ancestor_depth: int | None = None
    descendant_depth: int | None = None
    include_partners: bool | None = None
    filters: dict | None = None
    # Optimistic-concurrency token: the ``version`` last read by the client.
    expected_version: int

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str | None) -> str | None:
        return None if value is None else _require_name(value)

    @field_validator("ancestor_depth", "descendant_depth")
    @classmethod
    def _validate_depth(cls, value: int | None) -> int | None:
        if value is not None and (value < 0 or value > 20):
            raise ValueError("Depth must be between 0 and 20")
        return value


class SavedViewPositionItem(BaseModel):
    node_id: str
    position_x: float
    position_y: float


class SavedViewUserStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    last_opened: str | None
    camera_x: float | None
    camera_y: float | None
    camera_zoom: float | None
    collapsed_node_ids: list[str] | None


class SavedViewUserStateUpdate(BaseModel):
    camera_x: float | None = None
    camera_y: float | None = None
    camera_zoom: float | None = None
    collapsed_node_ids: list[str] | None = None
