"""SQLAlchemy ORM models.

Importing this package ensures every model is registered on ``Base.metadata``
so that table creation / migrations see the full schema.
"""

from app.models.activity import ActivityLog
from app.models.admin_audit import AdminAuditLog
from app.models.backup import BackupRecord
from app.models.content import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    GeocodeCache,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
)
from app.models.family import Member, MemberDisease, Relation, RelationType
from app.models.friendship import Friendship
from app.models.job import BackgroundJob
from app.models.legal import LegalAcceptance, LegalDocumentVersion
from app.models.quality import QualityIssueDismissal
from app.models.setting import AppSetting, FeatureFlagOverride
from app.models.tree import Tree, TreeInvitation, TreeMembership
from app.models.user import User
from app.models.virtual_view import (
    VirtualView,
    VirtualViewMemberMatch,
    VirtualViewPosition,
    VirtualViewSource,
)

__all__ = [
    "ActivityLog",
    "AdminAuditLog",
    "BackgroundJob",
    "User",
    "Tree",
    "TreeMembership",
    "TreeInvitation",
    "Friendship",
    "VirtualView",
    "VirtualViewSource",
    "VirtualViewMemberMatch",
    "VirtualViewPosition",
    "Member",
    "Relation",
    "RelationType",
    "MemberDisease",
    "GalleryImage",
    "GalleryMemberLink",
    "Event",
    "EventMemberLink",
    "GeocodeCache",
    "Document",
    "DocumentFile",
    "DocumentMemberLink",
    "EventDocumentLink",
    "Story",
    "StoryDocumentLink",
    "StoryMemberLink",
    "AppSetting",
    "FeatureFlagOverride",
    "BackupRecord",
    "LegalAcceptance",
    "LegalDocumentVersion",
    "QualityIssueDismissal",
]
