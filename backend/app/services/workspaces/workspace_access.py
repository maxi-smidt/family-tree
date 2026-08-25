"""Read the effective access list (owner + members) for a tree."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User, Workspace, WorkspaceMembership, WorkspaceSectionGrant
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
    # Section-scoped grants (#993): listed as their own rows, one per grant,
    # so an owner can audit a collaborator's full access rather than seeing
    # only their workspace-wide row (if any).
    section_grants = db.scalars(
        select(WorkspaceSectionGrant).where(WorkspaceSectionGrant.workspace_id == tree.id)
    ).all()
    for g in section_grants:
        grant_user = db.get(User, g.user_id)
        if grant_user:
            result.append(
                WorkspaceMemberOut(
                    user_id=grant_user.id,
                    username=grant_user.username,
                    role=g.role,
                    restrictions=list(g.restrictions or []),
                    section_id=g.section_id,
                )
            )
    return result
