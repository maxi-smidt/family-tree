"""Schemas for the sub-tree extraction endpoint."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# "whole_family" (default): everyone attached to the root who isn't part of
# the root's own "staying" family (see services/extract.py for the exact
# two-sided BFS definition) — depth and include_partners do not apply.
# "descendants" / "ancestors": traverse parent-edges from the root, honouring
# depth and include_partners as before.
Direction = Literal["whole_family", "descendants", "ancestors"]


class SubtreeExtractRequest(BaseModel):
    name: str
    source_tree_id: str
    root_member_id: str
    direction: Direction = "whole_family"
    depth: int | None = Field(default=None, ge=0)
    include_partners: bool = True


class SubtreePreview(BaseModel):
    member_count: int
    relation_count: int
    # Relations crossing the cut that would be deleted, and the on-disk size
    # of media files that would relocate with the branch.
    severed_relation_count: int = 0
    media_bytes: int = 0
