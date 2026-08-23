"""Read the effective access list (owner + members) for a tree."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User, Workspace, WorkspaceMembership
from app.schemas.workspace import WorkspaceMemberOut


def list_tree_access(db: Session, tree: Workspace) -> list[WorkspaceMemberOut]:
    owner = db.get(User, tree.owner_id)
    result = [WorkspaceMemberOut(user_id=owner.id, username=owner.username, role="owner")]
    memberships = db.scalars(
        select(WorkspaceMembership).where(WorkspaceMembership.workspace_id == tree.id)
    ).all()
    for m in memberships:
        member_user = db.get(User, m.user_id)
        if member_user:
            result.append(
                WorkspaceMemberOut(
                    user_id=member_user.id,
                    username=member_user.username,
                    role=m.role,
                    restrictions=list(m.restrictions or []),
                )
            )
    return result
