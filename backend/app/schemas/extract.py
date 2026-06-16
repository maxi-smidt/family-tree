"""Schemas for the sub-tree extraction endpoint."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Direction = Literal["descendants", "ancestors", "both"]


class SubtreeExtractRequest(BaseModel):
    name: str
    source_tree_id: str
    root_member_id: str
    direction: Direction = "descendants"
    depth: int | None = Field(default=None, ge=0)
    include_partners: bool = True


class SubtreePreview(BaseModel):
    member_count: int
    relation_count: int
