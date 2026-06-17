"""Tree lifecycle, sharing and metadata."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    accessible_tree_ids,
    get_current_user,
    get_current_user_optional,
    get_readable_tree,
    get_readable_tree_public,
    get_writable_tree,
    role_for,
)
from app.db.base import new_uuid, utcnow_iso
from app.db.session import get_db
from app.models import Tree, TreeMembership, User
from app.schemas.extract import SubtreeExtractRequest, SubtreePreview
from app.schemas.merge import TreeMergePreview, TreeMergePreviewRequest
from app.schemas.tree import (
    MemberRestrictionsUpdate,
    PublicAccessUpdate,
    ShareCandidate,
    TreeCreate,
    TreeMemberOut,
    TreeMerge,
    TreeOut,
    TreeShare,
    TreeStorageUsageOut,
    TreeTransfer,
    TreeUpdate,
)
from app.services import friendships
from app.services.extract import compute_subtree_preview, extract_subtree
from app.services.feature_service import DEFAULT_RESTRICTIONS, RESTRICTABLE_DOMAINS
from app.services.merge import compute_merge_preview, merge_trees
from app.services.storage import delete_tree_media
from app.services.storage_usage import compute_usage, owner_quotas

router = APIRouter(prefix="/trees", tags=["trees"])


def _tree_out(
    db: Session, tree: Tree, user: User | None, shared_count: int | None = None
) -> TreeOut:
    out = TreeOut.model_validate(tree)
    out.role = role_for(db, tree, user) if user is not None else "viewer"
    if shared_count is None:
        shared_count = db.scalar(
            select(func.count())
            .select_from(TreeMembership)
            .where(TreeMembership.tree_id == tree.id)
        )
    out.shared_count = shared_count or 0
    if user is not None and out.role not in ("owner",) and not user.is_admin:
        membership = db.get(TreeMembership, (tree.id, user.id))
        out.restrictions = list(membership.restrictions or []) if membership else []
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
    db.commit()
    db.refresh(tree)
    return _tree_out(db, tree, user)


@router.post("/merge/preview", response_model=TreeMergePreview)
def merge_preview(
    payload: TreeMergePreviewRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compute a merge preview (no data is written)."""
    return compute_merge_preview(db, user, payload.source_a, payload.source_b)


@router.post("/merge", response_model=TreeOut, status_code=201)
def merge(
    payload: TreeMerge,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="A name is required")
    tree = merge_trees(
        db, user, payload.name, payload.source_a, payload.source_b, payload.resolutions
    )
    return _tree_out(db, tree, user)


@router.post("/extract-subtree/preview", response_model=SubtreePreview)
def extract_subtree_preview(
    payload: SubtreeExtractRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compute a sub-tree extraction preview (no data is written)."""
    return compute_subtree_preview(db, user, payload)


@router.post("/extract-subtree", response_model=TreeOut, status_code=201)
def extract_subtree_endpoint(
    payload: SubtreeExtractRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="A name is required")
    tree = extract_subtree(db, user, payload)
    return _tree_out(db, tree, user)


@router.get("/{tree_id}", response_model=TreeOut)
def get_tree(
    tree: Tree = Depends(get_readable_tree_public),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    # Selecting a tree counts as "opening" it (only for authenticated users).
    if user is not None:
        tree.last_opened = utcnow_iso()
        db.commit()
    return _tree_out(db, tree, user)


@router.get("/{tree_id}/metadata")
def get_metadata(tree: Tree = Depends(get_readable_tree_public)):
    return {
        "id": tree.id,
        "name": tree.name,
        "createdAt": tree.created_at,
        "lastOpened": tree.last_opened,
    }


@router.get("/{tree_id}/storage", response_model=TreeStorageUsageOut)
def get_storage_usage(
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    """Return per-tree storage usage (tree rows + media files) and quota limits."""
    usage = compute_usage(db, tree.id)
    quotas = owner_quotas(db, tree)
    return TreeStorageUsageOut(
        tree_bytes=usage["tree_bytes"],
        media_bytes=usage["media_bytes"],
        total_bytes=usage["total_bytes"],
        tree_quota_bytes=quotas["tree_quota_bytes"],
        media_quota_bytes=quotas["media_quota_bytes"],
        total_quota_bytes=quotas["total_quota_bytes"],
    )


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


# --- Public access ---------------------------------------------------------
@router.patch("/{tree_id}/public", response_model=TreeOut)
def set_public_access(
    payload: PublicAccessUpdate,
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can change public access"
        )
    if payload.public_role not in (None, "viewer"):
        raise HTTPException(
            status_code=400, detail="public_role must be 'viewer' or null"
        )
    tree.public_role = payload.public_role
    db.commit()
    db.refresh(tree)
    return _tree_out(db, tree, user)


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
                    user_id=member_user.id,
                    username=member_user.username,
                    role=m.role,
                    restrictions=list(m.restrictions or []),
                )
            )
    return result


@router.get("/{tree_id}/access/candidates", response_model=list[ShareCandidate])
def list_share_candidates(
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Users this tree can still be shared with: the owner's accepted friends
    who are not already members. Only the owner may enumerate them.

    Sharing is friendship-gated, so the picker is the owner's friend list rather
    than every account — this also keeps the full user list unenumerable. Admins
    sharing someone else's tree fall back to the *tree owner's* friends."""
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can share a tree")
    member_ids = set(
        db.scalars(
            select(TreeMembership.user_id).where(TreeMembership.tree_id == tree.id)
        ).all()
    )
    member_ids.add(tree.owner_id)
    friend_ids = friendships.accepted_friend_ids(db, tree.owner_id) - member_ids
    if not friend_ids:
        return []
    candidates = db.scalars(
        select(User)
        .where(User.id.in_(friend_ids), User.is_active.is_(True))
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
    if not user.is_admin and not friendships.are_friends(db, tree.owner_id, target.id):
        raise HTTPException(
            status_code=403, detail="You can only share with friends"
        )

    membership = db.get(TreeMembership, (tree.id, target.id))
    if membership is None:
        db.add(
            TreeMembership(
                tree_id=tree.id,
                user_id=target.id,
                role=payload.role,
                restrictions=DEFAULT_RESTRICTIONS,
            )
        )
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


@router.patch(
    "/{tree_id}/access/{user_id}/restrictions",
    response_model=list[TreeMemberOut],
)
def update_member_restrictions(
    user_id: str,
    payload: MemberRestrictionsUpdate,
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can manage restrictions"
        )
    invalid = set(payload.restrictions) - RESTRICTABLE_DOMAINS
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid domains: {sorted(invalid)}")
    membership = db.get(TreeMembership, (tree.id, user_id))
    if membership is None:
        raise HTTPException(status_code=404, detail="Membership not found")
    membership.restrictions = payload.restrictions or None
    db.commit()
    return list_access(tree=tree, db=db)


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
    if not user.is_admin and not friendships.are_friends(db, tree.owner_id, target.id):
        raise HTTPException(
            status_code=403, detail="You can only transfer to a friend"
        )

    tree.owner_id = target.id
    membership = db.get(TreeMembership, (tree.id, target.id))
    if membership is not None:
        db.delete(membership)
    db.commit()
    db.refresh(tree)
    return list_access(tree=tree, db=db)


