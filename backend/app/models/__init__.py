"""SQLAlchemy ORM models.

Importing this package ensures every model is registered on ``Base.metadata``
so that table creation / migrations see the full schema.
"""

from app.models.activity import ActivityLog
from app.models.admin_audit import AdminAuditLog
from app.models.backup import BackupRecord, RestoreMarker
from app.models.content import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    DocumentUpload,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    GalleryUnknownFace,
    GeocodeCache,
    MemberTask,
    MemberTaskLink,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
)
from app.models.family import Member, MemberDisease, Relation, RelationType
from app.models.friendship import Friendship
from app.models.identity_link import (
    IdentityLink,
    IdentityLinkBlock,
    IdentityLinkEvent,
    IdentityLinkIdempotencyKey,
)
from app.models.job import BackgroundJob
from app.models.legal import LegalAcceptance, LegalDocumentVersion
from app.models.notification import Notification
from app.models.provenance import ContentScope, ContentType
from app.models.quality import QualityIssueDismissal
from app.models.saved_view import (
    SavedView,
    SavedViewPosition,
    SavedViewSection,
    SavedViewUserState,
)
from app.models.section import Section, SectionMember, SectionPosition
from app.models.setting import AppSetting
from app.models.user import User
from app.models.virtual_view import (
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
    VirtualViewSource,
    VirtualViewUserState,
)
from app.models.workspace import (
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
    WorkspaceSectionGrant,
    WorkspaceSectionPublicLink,
    WorkspaceUserState,
)

__all__ = [
    "ActivityLog",
    "AdminAuditLog",
    "BackgroundJob",
    "User",
    "Workspace",
    "WorkspaceMembership",
    "WorkspaceInvitation",
    "WorkspaceSectionGrant",
    "WorkspaceSectionPublicLink",
    "WorkspaceUserState",
    "Friendship",
    "VirtualView",
    "VirtualViewSource",
    "VirtualViewMemberMatch",
    "VirtualViewPosition",
    "VirtualViewUserState",
    "Member",
    "Relation",
    "RelationType",
    "MemberDisease",
    "GalleryImage",
    "GalleryMemberLink",
    "GalleryUnknownFace",
    "Event",
    "EventMemberLink",
    "GeocodeCache",
    "Document",
    "DocumentFile",
    "DocumentMemberLink",
    "DocumentUpload",
    "EventDocumentLink",
    "Story",
    "StoryDocumentLink",
    "StoryMemberLink",
    "MemberTask",
    "MemberTaskLink",
    "AppSetting",
    "BackupRecord",
    "RestoreMarker",
    "LegalAcceptance",
    "LegalDocumentVersion",
    "QualityIssueDismissal",
    "Notification",
    "Section",
    "SectionMember",
    "SectionPosition",
    "SavedView",
    "SavedViewSection",
    "SavedViewPosition",
    "SavedViewUserState",
    "ContentScope",
    "ContentType",
    "IdentityLink",
    "IdentityLinkBlock",
    "IdentityLinkEvent",
    "IdentityLinkIdempotencyKey",
]
