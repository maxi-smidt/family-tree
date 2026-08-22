"""Shared read-side helpers for member routes.

Covers the public-vs-authenticated visibility rule and tree-scoped member
lookup used across the member, subtree and link routers.
"""

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.models import Member, Tree
from app.models.user import User
from app.schemas.family import PublicMemberOut
from app.services.tree_roles import role_for

PUBLIC_MEMBER_COLUMNS = (
    Member.id,
    Member.gender,
    Member.academic_title,
    Member.first_name,
    Member.middle_names,
    Member.baptismal_name,
    Member.last_name,
    Member.maiden_name,
    Member.image_data,
    Member.date_of_birth,
    Member.date_of_death,
    Member.deceased,
    Member.is_collapsed,
    Member.position_x,
    Member.position_y,
)


def public_only(db: Session, tree: Tree, user: User | None) -> bool:
    """Whether *user* may only see the public member surface for *tree*."""
    return user is None or (not user.is_admin and role_for(db, tree, user) is None)


def public_member_payloads(rows: list) -> list[dict]:
    return [PublicMemberOut(**row._mapping).model_dump(by_alias=True) for row in rows]


def get_member(db: Session, tree: Tree, member_id: str) -> Member:
    member = db.get(Member, member_id)
    if member is None or member.tree_id != tree.id:
        raise NotFoundError("Member not found")
    return member
