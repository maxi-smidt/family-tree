"""Read the effective access list (owner + members) for a tree."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Tree, TreeMembership, User
from app.schemas.tree import TreeMemberOut


def list_tree_access(db: Session, tree: Tree) -> list[TreeMemberOut]:
    owner = db.get(User, tree.owner_id)
    result = [TreeMemberOut(user_id=owner.id, username=owner.username, role="owner")]
    memberships = db.scalars(
        select(TreeMembership).where(TreeMembership.tree_id == tree.id)
    ).all()
    for m in memberships:
        member_user = db.get(User, m.user_id)
        if member_user:
            result.append(
                TreeMemberOut(
                    user_id=member_user.id,
                    username=member_user.username,
                    role=m.role,
                    restrictions=list(m.restrictions or []),
                )
            )
    return result
