from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import FamilyTreeBaseModel
from app.schemas.family import MemberOut


class RecomputeMatchesResult(FamilyTreeBaseModel):
    group_count: int
    merged_member_count: int


class VirtualViewSourceWorkspaceRef(FamilyTreeBaseModel):
    id: str
    name: str


class VirtualViewMetadataOut(FamilyTreeBaseModel):
    id: str
    name: str
    created_at: str
    last_opened: str | None = None
    source_workspaces: list[VirtualViewSourceWorkspaceRef]
    overlap_count: int
    has_layout: bool


class VirtualViewSourceOut(BaseModel):
    # ``workspace_id`` carries the source id regardless of kind (a real tree id or a
    # ``vv_`` view id) so existing clients keep working.
    workspace_id: str
    workspace_name: str
    accessible: bool
    kind: str = "tree"  # "tree" | "view"
    is_virtual: bool = False


class VirtualViewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    owner_id: str
    created_at: str
    last_opened: str | None = None
    role: str = "viewer"
    shared_count: int = 0
    is_virtual: bool = True
    sources: list[VirtualViewSourceOut] = Field(default_factory=list)


class VirtualViewCreate(BaseModel):
    name: str
    source_workspace_ids: list[str]


class VirtualViewUpdate(BaseModel):
    name: str | None = None
    source_workspace_ids: list[str] | None = None


class VirtualMemberOut(MemberOut):
    source_workspace_id: str
    source_workspace_name: str
    source_workspace_ids: list[str] = Field(default_factory=list)
    source_workspace_names: list[str] = Field(default_factory=list)
    merged_from_ids: list[str] = Field(default_factory=list)
    is_merged: bool = False


class VirtualPositionItem(FamilyTreeBaseModel):
    id: str
    position_x: float
    position_y: float
