from pydantic import BaseModel, ConfigDict


class TreeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    owner_id: str
    created_at: str
    last_opened: str | None = None
    # Access level of the requesting user: "owner", "editor" or "viewer".
    role: str = "owner"


class TreeCreate(BaseModel):
    name: str
    # Optional client-provided id (the SPA generates UUIDs locally).
    id: str | None = None


class TreeUpdate(BaseModel):
    name: str | None = None


class TreeShare(BaseModel):
    username: str
    role: str = "editor"  # "viewer" or "editor"


class TreeMerge(BaseModel):
    name: str
    source_a: str
    # Optional second source; when omitted the merge is effectively a copy.
    source_b: str | None = None


class TreeMemberOut(BaseModel):
    """A user that has access to a tree, with their role."""

    user_id: str
    username: str
    role: str  # "owner", "editor" or "viewer"
