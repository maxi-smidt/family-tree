"""SQLAlchemy ORM models.

Importing this package ensures every model is registered on ``Base.metadata``
so that table creation / migrations see the full schema.
"""

from app.models.activity import ActivityLog
from app.models.backup import BackupRecord
from app.models.content import (
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    GeocodeCache,
    Story,
    StoryAttachment,
    StoryMemberLink,
)
from app.models.family import Member, MemberDisease, Relation, RelationType
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
    "User",
    "Tree",
    "TreeMembership",
    "TreeInvitation",
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
    "Story",
    "StoryAttachment",
    "StoryMemberLink",
    "AppSetting",
    "FeatureFlagOverride",
    "BackupRecord",
]
