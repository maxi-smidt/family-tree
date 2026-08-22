"""Sharing a tree with other users: access grants, restrictions, batch ops."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_tree
from app.db.session import get_db
from app.models import Tree, TreeMembership, User
from app.models.family import Member
from app.schemas.notification import TreeSharedPayload, TreeUnsharedPayload
from app.schemas.tree import (
    LinkedShareTreeOut,
    MemberRestrictionsUpdate,
    ShareCandidate,
    TreeAccessBatchRevoke,
    TreeMemberOut,
    TreeShare,
    TreeShareBatch,
)
from app.services.activity.activity import record_activity
from app.services.collaboration import friendships, notification_service
from app.services.event_bus import publish_tree_event
from app.services.system import feature_service
from app.services.system.feature_service import DEFAULT_RESTRICTIONS, RESTRICTABLE_DOMAINS
from app.services.trees.tree_access import list_tree_access
from app.services.trees.tree_links import reachable_linked_trees

router = APIRouter(prefix="/trees", tags=["trees"])

_BATCH_TREE_IDS_MAX = 100


@router.get("/{tree_id}/access", response_model=list[TreeMemberOut])
def list_access(
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    return list_tree_access(db, tree)


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
    is_new_grant = membership is None
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
    if is_new_grant:
        record_activity(
            db, tree_id=tree.id, actor=user, action="create",
            target_type="share", target_id=target.id, target_label=target.username,
            details={"role": payload.role},
        )
    db.commit()
    publish_tree_event(
        db, tree, "tree.access_changed", {"tree_id": tree.id}, extra_user_ids=[target.id]
    )
    if is_new_grant:
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
        notification_service.create_notification(
            db,
            target.id,
            "tree_shared",
            TreeSharedPayload(
                tree_id=tree.id,
                tree_name=tree.name,
                role=payload.role,
                actor_username=user.username,
            ),
        )
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
        revoked_user = db.get(User, user_id)
        db.delete(membership)
        record_activity(
            db, tree_id=tree.id, actor=user, action="delete",
            target_type="share", target_id=user_id,
            target_label=revoked_user.username if revoked_user else None,
        )
        db.commit()
        publish_tree_event(
            db,
            tree,
            "tree.access_changed",
            {"tree_id": tree.id},
            extra_user_ids=[user_id],
        )
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
        notification_service.create_notification(
            db,
            user_id,
            "tree_unshared",
            TreeUnsharedPayload(tree_id=tree.id, tree_name=tree.name),
        )


@router.get(
    "/{tree_id}/access/linked-trees", response_model=list[LinkedShareTreeOut]
)
def list_linked_share_trees(
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    username: str | None = None,
):
    """Trees reachable from this one via member links, for the batch-share UI.

    Convenience listing only: it never grants anything by itself. Excludes the
    anchor tree. Readable-but-not-owned linked trees are still included (with
    ``manageable=False``) so the UI can show them as "can't be offered" rather
    than silently omitting them; trees the actor cannot read at all are
    skipped so their existence isn't leaked.
    """
    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can share a tree")

    target_user: User | None = None
    if username is not None:
        target_user = db.scalar(select(User).where(User.username == username))
        if target_user is None:
            raise HTTPException(status_code=404, detail="User not found")

    linked = reachable_linked_trees(db, tree, user)
    result: list[LinkedShareTreeOut] = []
    for t in linked:
        member_count = (
            db.scalar(
                select(func.count()).select_from(Member).where(Member.tree_id == t.id)
            )
            or 0
        )
        manageable = t.owner_id == user.id or user.is_admin
        target_role: str | None = None
        if target_user is not None:
            if t.owner_id == target_user.id:
                target_role = "owner"
            else:
                membership = db.get(TreeMembership, (t.id, target_user.id))
                target_role = membership.role if membership else None
        result.append(
            LinkedShareTreeOut(
                tree_id=t.id,
                name=t.name,
                member_count=member_count,
                manageable=manageable,
                target_role=target_role,
            )
        )
    return result


@router.post("/{tree_id}/access/batch", response_model=list[TreeMemberOut])
def share_trees_batch(
    payload: TreeShareBatch,
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Grant one user the same role across the anchor tree and a batch of
    (typically linked) trees in a single call. All-or-nothing: every tree_id
    is validated before any grant is applied."""
    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can share a tree")
    if payload.role not in ("viewer", "editor"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if len(payload.tree_ids) > _BATCH_TREE_IDS_MAX:
        raise HTTPException(status_code=400, detail="Too many trees")

    target = db.scalar(select(User).where(User.username == payload.username))
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    trees: list[Tree] = []
    for tree_id in payload.tree_ids:
        t = db.get(Tree, tree_id)
        if t is None:
            raise HTTPException(status_code=404, detail="Tree not found")
        if t.owner_id != user.id and not user.is_admin:
            raise HTTPException(
                status_code=403, detail="Only the owner can share a tree"
            )
        if target.id == t.owner_id:
            raise HTTPException(status_code=400, detail="User already owns this tree")
        if not user.is_admin and not friendships.are_friends(db, t.owner_id, target.id):
            raise HTTPException(status_code=403, detail="You can only share with friends")
        trees.append(t)

    logged_trees: list[Tree] = []
    for t in trees:
        membership = db.get(TreeMembership, (t.id, target.id))
        is_new_grant = membership is None
        if membership is None:
            db.add(
                TreeMembership(
                    tree_id=t.id,
                    user_id=target.id,
                    role=payload.role,
                    restrictions=DEFAULT_RESTRICTIONS,
                )
            )
        else:
            membership.role = payload.role
        if is_new_grant:
            record_activity(
                db, tree_id=t.id, actor=user, action="create",
                target_type="share", target_id=target.id, target_label=target.username,
                details={"role": payload.role},
            )
            logged_trees.append(t)
    db.commit()

    for t in trees:
        publish_tree_event(
            db, t, "tree.access_changed", {"tree_id": t.id}, extra_user_ids=[target.id]
        )
    for t in logged_trees:
        publish_tree_event(db, t, "activity.entry_added", {"tree_id": t.id})
        notification_service.create_notification(
            db,
            target.id,
            "tree_shared",
            TreeSharedPayload(
                tree_id=t.id,
                tree_name=t.name,
                role=payload.role,
                actor_username=user.username,
            ),
        )
    return list_access(tree=tree, db=db)


@router.post("/{tree_id}/access/batch-revoke", status_code=204)
def revoke_access_batch(
    payload: TreeAccessBatchRevoke,
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke one user's access across a batch of (typically linked) trees in
    a single call. Trees without an existing membership for the user are
    silently skipped."""
    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can manage sharing")
    if len(payload.tree_ids) > _BATCH_TREE_IDS_MAX:
        raise HTTPException(status_code=400, detail="Too many trees")

    trees: list[Tree] = []
    for tree_id in payload.tree_ids:
        t = db.get(Tree, tree_id)
        if t is None:
            raise HTTPException(status_code=404, detail="Tree not found")
        if t.owner_id != user.id and not user.is_admin:
            raise HTTPException(
                status_code=403, detail="Only the owner can manage sharing"
            )
        trees.append(t)

    revoked_user = db.get(User, payload.user_id)
    affected: list[Tree] = []
    for t in trees:
        membership = db.get(TreeMembership, (t.id, payload.user_id))
        if membership is not None:
            db.delete(membership)
            record_activity(
                db, tree_id=t.id, actor=user, action="delete",
                target_type="share", target_id=payload.user_id,
                target_label=revoked_user.username if revoked_user else None,
            )
            affected.append(t)
    db.commit()

    for t in affected:
        publish_tree_event(
            db,
            t,
            "tree.access_changed",
            {"tree_id": t.id},
            extra_user_ids=[payload.user_id],
        )
        publish_tree_event(db, t, "activity.entry_added", {"tree_id": t.id})
        notification_service.create_notification(
            db,
            payload.user_id,
            "tree_unshared",
            TreeUnsharedPayload(tree_id=t.id, tree_name=t.name),
        )


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
    before_restrictions = list(membership.restrictions or [])
    membership.restrictions = payload.restrictions or None
    after_restrictions = list(membership.restrictions or [])
    target_user = db.get(User, user_id)
    logged = before_restrictions != after_restrictions
    if logged:
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="share", target_id=user_id,
            target_label=target_user.username if target_user else None,
            details={
                "before": {"restrictions": before_restrictions},
                "after": {"restrictions": after_restrictions},
            },
        )
    db.commit()
    publish_tree_event(
        db,
        tree,
        "tree.access_changed",
        {"tree_id": tree.id},
        extra_user_ids=[user_id],
    )
    if logged:
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    return list_access(tree=tree, db=db)
