"""Schemas for the merge-preview and resolution endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.schemas.family import MemberOut


class TreeMergePreviewRequest(BaseModel):
    source_a: str
    source_b: str | None = None


class DuplicatePair(BaseModel):
    member_a: MemberOut
    member_b: MemberOut
    match: Literal["exact", "possible"]
    conflicts: list[str]
    default_action: Literal["merge", "keep_both"]


class TreeMergePreview(BaseModel):
    total_members: int
    merged_count: int
    duplicates: list[DuplicatePair]


# --- Resolution types (used in the merge request) --------------------------


class MergeResolution(BaseModel):
    member_a_id: str
    member_b_id: str
    action: Literal["merge", "keep_both"] = "merge"
    fields: dict[str, Literal["a", "b", "combine"]] = {}
