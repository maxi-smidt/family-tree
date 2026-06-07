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
    # Number of other users this tree is shared with (memberships). Lets owners
    # see at a glance whether a tree is shared, without a second request.
    shared_count: int = 0


class TreeCreate(BaseModel):
    name: str
    # Optional client-provided id (the SPA generates UUIDs locally).
    id: str | None = None


class TreeUpdate(BaseModel):
    name: str | None = None


class TreeShare(BaseModel):
    username: str
    role: str = "editor"  # "viewer" or "editor"


class TreeTransfer(BaseModel):
    """Hand a tree's ownership to another (active) user."""

    username: str


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


class ShareCandidate(BaseModel):
    """A user that a tree can be shared with (not yet a member or the owner)."""

    user_id: str
    username: str
