from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.base import FamilyTreeBaseModel
from app.schemas.family import MemberOut
from app.schemas.merge import MergeResolution


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
    # null = private; "viewer" = public read-only.
    public_role: str | None = None
    # True when a public tree is password-gated (the hash is never exposed).
    public_password_protected: bool = False
    # Domains the requesting member may not see. Empty for owner/admin.
    restrictions: list[str] = []


class TreeMetadataOut(FamilyTreeBaseModel):
    id: str
    name: str
    created_at: str
    last_opened: str | None = None


class TreeCreate(BaseModel):
    name: str


class TreeUpdate(BaseModel):
    name: str | None = None


class TreeShare(BaseModel):
    username: str
    role: str = "editor"  # "viewer" or "editor"


class TreeTransfer(BaseModel):
    """Hand a tree's ownership to another (active) user."""

    username: str
    retain_role: str | None = None  # "viewer" | "editor" | None


class TreeTransferResult(BaseModel):
    """Result of a successful ownership transfer."""

    access: list[TreeMemberOut]
    undo_available_until: str | None = None


class TreeMerge(BaseModel):
    name: str
    source_a: str
    # Optional second source; when omitted the merge is effectively a copy.
    source_b: str | None = None
    # Optional per-pair conflict resolutions (new in #166). When None the old
    # behaviour is preserved exactly (backwards-compatible).
    resolutions: list[MergeResolution] | None = None


class TreeMemberOut(BaseModel):
    """A user that has access to a tree, with their role."""

    user_id: str
    username: str
    role: str  # "owner", "editor" or "viewer"
    restrictions: list[str] = []


class MemberSubtreeOut(FamilyTreeBaseModel):
    """Result of creating a linked subtree: the new tree plus the updated
    anchor member (whose linked_tree_id/linked_member_id now point at the
    seeded counterpart)."""

    tree: TreeOut
    anchor: MemberOut


class MemberRestrictionsUpdate(BaseModel):
    restrictions: list[str] = []


class ShareCandidate(BaseModel):
    """A user that a tree can be shared with (not yet a member or the owner)."""

    user_id: str
    username: str


class InvitationCreate(BaseModel):
    email: str | None = None
    role: str = "editor"
    expires_in_days: int | None = None


class InvitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tree_id: str
    email: str | None = None
    role: str
    created_at: str
    expires_at: str | None = None
    accepted_at: str | None = None
    revoked_at: str | None = None
    token: str | None = None
    status: str = "pending"


class InvitationAcceptResult(BaseModel):
    tree_id: str
    tree_name: str
    role: str


class InvitationPreview(BaseModel):
    tree_name: str
    role: str
    valid: bool
    requires_account: bool


class PublicAccessUpdate(BaseModel):
    public_role: str | None = None


class PublicPasswordUpdate(BaseModel):
    # New password; null or empty string clears/removes protection.
    password: str | None = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return ""
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 UTF-8 bytes")
        if len(value) < 8:
            raise ValueError("Password must be at least 8 characters")
        return value


class PublicTreeUnlock(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Password is required")
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 UTF-8 bytes")
        return value


class PublicTreeUnlockResult(BaseModel):
    token: str


class TreeStorageUsageOut(BaseModel):
    """Owner-wide storage usage plus the owner's effective quota limits."""

    tree_bytes: int
    media_bytes: int
    # total_bytes is the reported sum of tree + media; it has no separate quota.
    total_bytes: int
    # Effective quota limits for the tree's owner (None = unlimited).
    tree_quota_bytes: int | None = None
    media_quota_bytes: int | None = None


class LinkGraphBridgeMember(BaseModel):
    """A bridge person backing one tree-to-tree link on an edge."""

    id: str
    name: str | None = None


class LinkGraphNode(BaseModel):
    """A tree reachable from the start tree via member links."""

    id: str
    name: str | None = None
    member_count: int | None = None
    # The requesting user's role on this tree ("owner"/"editor"/"viewer"), or
    # None for inaccessible placeholders.
    role: str | None = None
    accessible: bool = True
    is_current: bool = False


class LinkGraphEdge(BaseModel):
    """One or more bridge-person links from a source tree to a target tree."""

    source_tree_id: str
    target_tree_id: str
    count: int
    bridge_members: list[LinkGraphBridgeMember] = []


class LinkGraphOut(BaseModel):
    nodes: list[LinkGraphNode]
    edges: list[LinkGraphEdge]
    truncated: bool = False


class LinkedShareTreeOut(BaseModel):
    """A tree reachable from the anchor tree via member links, as offered by
    the batch-sharing UI."""

    tree_id: str
    name: str
    member_count: int
    # True when the requesting user is this tree's owner (or an admin), i.e.
    # they can actually grant/revoke access on it.
    manageable: bool
    # When a ``username`` was supplied: that user's role on this tree
    # ("owner"/"editor"/"viewer"), or None if they have no access. Always
    # None when no username was given.
    target_role: str | None = None


class TreeShareBatch(BaseModel):
    """Grant one user the same role across the anchor tree and a batch of
    linked trees in one call."""

    username: str
    role: str = "editor"  # "viewer" or "editor"
    tree_ids: list[str]


class TreeAccessBatchRevoke(BaseModel):
    """Revoke one user's access across a batch of trees in one call."""

    user_id: str
    tree_ids: list[str]
