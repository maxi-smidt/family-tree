"""Schemas for the merge-preview and resolution endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.family import MemberOut


class WorkspaceMergePreviewRequest(BaseModel):
    source_a: str
    source_b: str | None = None


class DuplicatePair(BaseModel):
    member_a: MemberOut
    member_b: MemberOut
    match: Literal["exact", "possible"]
    conflicts: list[str]
    default_action: Literal["merge", "keep_both"]


class WorkspaceMergePreview(BaseModel):
    total_members: int
    merged_count: int
    duplicates: list[DuplicatePair]


class LinkCandidatesOut(BaseModel):
    """Same-named members in a target tree that could be the bridge
    counterpart for a tree-in-tree link, shaped like merge duplicate pairs so
    the client can reuse ``MergeConflictResolver``."""

    candidates: list[DuplicatePair]


# --- Resolution types (used in the merge request) --------------------------


FieldChoice = Literal["a", "b", "combine"]


class MergeResolution(BaseModel):
    member_a_id: str
    member_b_id: str
    action: Literal["merge", "keep_both"] = "merge"
    fields: dict[str, FieldChoice] = Field(default_factory=dict)


# --- In-place, same-tree member merge (#729) --------------------------------


class MemberMergeTransferCounts(BaseModel):
    relations: int
    events: int
    stories: int
    gallery: int
    documents: int
    tasks: int
    diseases: int


class MemberMergePreviewOut(BaseModel):
    pair: DuplicatePair
    transfer: MemberMergeTransferCounts
    would_create_cycle: bool = False


class MemberMergeRequest(BaseModel):
    keep_id: str
    remove_id: str
    fields: dict[str, FieldChoice] = Field(default_factory=dict)
