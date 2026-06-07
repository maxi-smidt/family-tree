"""Tree lifecycle, sharing, metadata and relation types."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    accessible_tree_ids,
    get_current_user,
    get_readable_tree,
    get_writable_tree,
    role_for,
)
from app.core.constants import DEFAULT_RELATION_TYPES
from app.db.base import new_uuid, utcnow_iso
from app.db.session import get_db
from app.models import RelationType, Tree, TreeMembership, User
from app.schemas.family import RelationTypeCreate, RelationTypeOut
from app.schemas.tree import (
    ShareCandidate,
    TreeCreate,
    TreeMemberOut,
    TreeMerge,
    TreeOut,
    TreeShare,
    TreeTransfer,
    TreeUpdate,
)
from app.services.merge import merge_trees
from app.services.storage import delete_tree_media

router = APIRouter(prefix="/trees", tags=["trees"])


def _tree_out(
    db: Session, tree: Tree, user: User, shared_count: int | None = None
) -> TreeOut:
    out = TreeOut.model_validate(tree)
    out.role = role_for(db, tree, user) or "viewer"
    if shared_count is None:
        shared_count = db.scalar(
            select(func.count())
            .select_from(TreeMembership)
            .where(TreeMembership.tree_id == tree.id)
        )
    out.shared_count = shared_count or 0
    return out


@router.get("", response_model=list[TreeOut])
def list_trees(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ids = accessible_tree_ids(db, user)
    trees = list(db.scalars(select(Tree).where(Tree.id.in_(ids))).all()) if ids else []
    trees.sort(key=lambda t: (t.last_opened or "", t.created_at), reverse=True)
    # Bulk-count memberships to avoid one query per tree.
    counts: dict[str, int] = (
        dict(
            db.execute(
                select(TreeMembership.tree_id, func.count())
                .where(TreeMembership.tree_id.in_(ids))
                .group_by(TreeMembership.tree_id)
            ).all()
        )
        if ids
        else {}
    )
    return [_tree_out(db, t, user, counts.get(t.id, 0)) for t in trees]


@router.post("", response_model=TreeOut, status_code=201)
def create_tree(
    payload: TreeCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tree = Tree(
        id=payload.id or new_uuid(),
        name=payload.name,
        owner_id=user.id,
        created_at=utcnow_iso(),
        last_opened=utcnow_iso(),
    )
    db.add(tree)
    # Flush the tree first so its row exists before the relation_types rows that
    # reference it (Postgres enforces the FK immediately).
    db.flush()
    for rt in DEFAULT_RELATION_TYPES:
        db.add(RelationType(tree_id=tree.id, id=rt))
    db.commit()
    db.refresh(tree)
    return _tree_out(db, tree, user)


@router.post("/merge", response_model=TreeOut, status_code=201)
def merge(
    payload: TreeMerge,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="A name is required")
    tree = merge_trees(db, user, payload.name, payload.source_a, payload.source_b)
    return _tree_out(db, tree, user)


@router.get("/{tree_id}", response_model=TreeOut)
def get_tree(
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Selecting a tree counts as "opening" it.
    tree.last_opened = utcnow_iso()
    db.commit()
    return _tree_out(db, tree, user)


@router.get("/{tree_id}/metadata")
def get_metadata(tree: Tree = Depends(get_readable_tree)):
    return {
        "id": tree.id,
        "name": tree.name,
        "createdAt": tree.created_at,
        "lastOpened": tree.last_opened,
    }


@router.patch("/{tree_id}", response_model=TreeOut)
def update_tree(
    payload: TreeUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.name is not None:
        tree.name = payload.name
    db.commit()
    db.refresh(tree)
    return _tree_out(db, tree, user)


@router.delete("/{tree_id}", status_code=204)
def delete_tree(
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can delete a tree")
    tree_id = tree.id
    db.delete(tree)
    db.commit()
    # The DB cascade clears the rows; remove the backing media files too.
    delete_tree_media(tree_id)


# --- Sharing ---------------------------------------------------------------
@router.get("/{tree_id}/access", response_model=list[TreeMemberOut])
def list_access(
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
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
                    user_id=member_user.id, username=member_user.username, role=m.role
                )
            )
    return result


@router.get("/{tree_id}/access/candidates", response_model=list[ShareCandidate])
def list_share_candidates(
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Active users this tree can still be shared with (excludes the owner and
    anyone who already has access). Only the owner may enumerate them."""
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can share a tree")
    member_ids = set(
        db.scalars(
            select(TreeMembership.user_id).where(TreeMembership.tree_id == tree.id)
        ).all()
    )
    member_ids.add(tree.owner_id)
    candidates = db.scalars(
        select(User)
        .where(User.id.notin_(member_ids), User.is_active.is_(True))
        .order_by(User.username)
    ).all()
    return [ShareCandidate(user_id=u.id, username=u.username) for u in candidates]


@router.post("/{tree_id}/access", response_model=list[TreeMemberOut])
def share_tree(
    payload: TreeShare,
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can share a tree")
    if payload.role not in ("viewer", "editor"):
        raise HTTPException(status_code=400, detail="Invalid role")

    target = db.scalar(select(User).where(User.username == payload.username))
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == tree.owner_id:
        raise HTTPException(status_code=400, detail="User already owns this tree")

    membership = db.get(TreeMembership, (tree.id, target.id))
    if membership is None:
        db.add(TreeMembership(tree_id=tree.id, user_id=target.id, role=payload.role))
    else:
        membership.role = payload.role
    db.commit()
    return list_access(tree=tree, db=db)


@router.delete("/{tree_id}/access/{user_id}", status_code=204)
def revoke_access(
    user_id: str,
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can manage sharing")
    membership = db.get(TreeMembership, (tree.id, user_id))
    if membership is not None:
        db.delete(membership)
        db.commit()


@router.post("/{tree_id}/transfer", response_model=list[TreeMemberOut])
def transfer_ownership(
    payload: TreeTransfer,
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hand ownership of a tree to another active user.

    Allowed for the current owner or an admin (e.g. to rescue a tree owned by a
    user pending deletion). The new owner's prior membership, if any, is dropped
    since ownership supersedes it.
    """
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can transfer a tree"
        )

    target = db.scalar(select(User).where(User.username == payload.username))
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == tree.owner_id:
        raise HTTPException(status_code=400, detail="User already owns this tree")
    if not target.is_active:
        raise HTTPException(
            status_code=400, detail="Cannot transfer to an inactive account"
        )

    tree.owner_id = target.id
    membership = db.get(TreeMembership, (tree.id, target.id))
    if membership is not None:
        db.delete(membership)
    db.commit()
    db.refresh(tree)
    return list_access(tree=tree, db=db)


# --- Relation types --------------------------------------------------------
@router.get("/{tree_id}/relation-types", response_model=list[RelationTypeOut])
def list_relation_types(
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    return db.scalars(select(RelationType).where(RelationType.tree_id == tree.id)).all()


@router.post(
    "/{tree_id}/relation-types", response_model=RelationTypeOut, status_code=201
)
def add_relation_type(
    payload: RelationTypeCreate,
    tree: Tree = Depends(get_writable_tree),
    db: Session = Depends(get_db),
):
    existing = db.get(RelationType, (tree.id, payload.id))
    if existing is None:
        existing = RelationType(
            tree_id=tree.id, id=payload.id, description=payload.description
        )
        db.add(existing)
        db.commit()
    return existing
