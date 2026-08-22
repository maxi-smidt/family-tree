"""Creating a new tree seeded from (and bridge-linked to) a member."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_writable_tree
from app.db.session import get_db
from app.models import Tree
from app.models.user import User
from app.schemas.family import MemberOut, MemberSubtreeCreate
from app.schemas.tree import MemberSubtreeOut, TreeOut
from app.services import feature_service
from app.services.member_access import get_member
from app.services.member_subtrees import create_linked_subtree

router = APIRouter(prefix="/trees/{tree_id}", tags=["members"])


@router.post(
    "/members/{member_id}/subtree",
    response_model=MemberSubtreeOut,
    status_code=201,
)
def create_member_subtree(
    member_id: str,
    payload: MemberSubtreeCreate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new tree seeded with a copy of this member and link both ways.

    The member becomes the "bridge person": a clone of their identity fields
    (including a copied photo) is created as the sole member of the new tree,
    and the two rows point at each other via linked_tree_id/linked_member_id,
    so navigation works in both directions and lands on the counterpart.
    """
    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    member = get_member(db, tree, member_id)
    if member.linked_tree_id is not None:
        raise HTTPException(status_code=409, detail="Member is already linked to a tree")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="A name is required")

    new_tree = create_linked_subtree(
        db, source_tree=tree, member=member, owner=user, name=name
    )
    return MemberSubtreeOut(
        tree=TreeOut.model_validate(new_tree),
        anchor=MemberOut.model_validate(member),
    )
