from pydantic import BaseModel, ConfigDict

from app.schemas.family import MemberOut


class VirtualViewSourceOut(BaseModel):
    # ``tree_id`` carries the source id regardless of kind (a real tree id or a
    # ``vv_`` view id) so existing clients keep working.
    tree_id: str
    tree_name: str
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
    sources: list[VirtualViewSourceOut] = []


class VirtualViewCreate(BaseModel):
    name: str
    source_tree_ids: list[str]


class VirtualViewUpdate(BaseModel):
    name: str | None = None
    source_tree_ids: list[str] | None = None


class VirtualMemberOut(MemberOut):
    source_tree_id: str
    source_tree_name: str
    source_tree_ids: list[str] = []
    source_tree_names: list[str] = []
    merged_from_ids: list[str] = []
    is_merged: bool = False


class VirtualPositionItem(BaseModel):
    id: str
    position_x: float
    position_y: float
