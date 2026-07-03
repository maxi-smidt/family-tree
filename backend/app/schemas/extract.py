"""Schemas for the sub-tree extraction endpoint."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

# "direct_family" (default): the root's family of origin — parents,
# siblings and their branches, with married-in spouses; the root's own
# children never move. See services/extract.py for the exact algorithm.
# "partnership": the root's partner(s), the partner's family, and the
# children the root shares with them.
Direction = Literal["direct_family", "partnership"]


class SubtreeExtractRequest(BaseModel):
    name: str
    source_tree_id: str
    root_member_id: str
    direction: Direction = "direct_family"


class SubtreePreview(BaseModel):
    member_count: int
    relation_count: int
    # Relations crossing the cut that would be deleted, and the on-disk size
    # of media files that would relocate with the branch.
    severed_relation_count: int = 0
    media_bytes: int = 0
