from pydantic import BaseModel, ConfigDict

from app.schemas.family import MemberOut


class VirtualViewSourceOut(BaseModel):
    tree_id: str
    tree_name: str
    accessible: bool


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
    sources: list[VirtualViewSourceOut] = []


class VirtualViewCreate(BaseModel):
    name: str
    source_tree_ids: list[str]


class VirtualViewUpdate(BaseModel):
    name: str | None = None
    source_tree_ids: list[str] | None = None


class VirtualMemberOut(MemberOut):
    sourceTreeId: str
    sourceTreeName: str
