"""Creating a new tree seeded from (and bridge-linked to) a member."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    get_workspace_access_write,
    get_writable_workspace,
)
from app.db.session import get_db
from app.models import Workspace
from app.models.user import User
from app.schemas.family import MemberOut, MemberSubtreeCreate
from app.schemas.workspace import MemberSubtreeOut, WorkspaceOut
from app.services.members.member_access import get_member
from app.services.members.member_subtrees import create_linked_subtree
from app.services.workspaces.visibility import WorkspaceAccessContext

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["members"])


@router.post(
    "/members/{member_id}/subtree",
    response_model=MemberSubtreeOut,
    status_code=201,
)
def create_member_subtree(
    member_id: str,
    payload: MemberSubtreeCreate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    context: WorkspaceAccessContext = Depends(get_workspace_access_write),
    db: Session = Depends(get_db),
):
    """Create a new tree seeded with a copy of this member and link both ways.

    The member becomes the "bridge person": a clone of their identity fields
    (including a copied photo) is created as the sole member of the new tree,
    and the two rows point at each other via linked_workspace_id/linked_member_id,
    so navigation works in both directions and lands on the counterpart.
    """
    member = get_member(db, tree, member_id)
    context.require_write_member(db, member.id)
    if member.linked_workspace_id is not None:
        raise HTTPException(status_code=409, detail="Member is already linked to a tree")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="A name is required")

    new_tree = create_linked_subtree(
        db, source_workspace=tree, member=member, owner=user, name=name
    )
    return MemberSubtreeOut(
        workspace=WorkspaceOut.model_validate(new_tree),
        anchor=MemberOut.model_validate(member),
    )
