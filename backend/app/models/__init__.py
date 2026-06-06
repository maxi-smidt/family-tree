"""SQLAlchemy ORM models.

Importing this package ensures every model is registered on ``Base.metadata``
so that table creation / migrations see the full schema.
"""

from app.models.content import (
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Story,
    StoryAttachment,
    StoryMemberLink,
)
from app.models.family import Member, MemberDisease, Relation, RelationType
from app.models.setting import AppSetting
from app.models.tree import Tree, TreeMembership
from app.models.user import User

__all__ = [
    "User",
    "Tree",
    "TreeMembership",
    "Member",
    "Relation",
    "RelationType",
    "MemberDisease",
    "GalleryImage",
    "GalleryMemberLink",
    "Event",
    "EventMemberLink",
    "Story",
    "StoryAttachment",
    "StoryMemberLink",
    "AppSetting",
]
