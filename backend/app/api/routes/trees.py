"""Tree lifecycle: create, list, read, update, delete."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    explicit_tree_ids,
    get_current_user,
    get_current_user_optional,
    get_readable_tree,
    get_readable_tree_public,
    get_writable_tree,
)
from app.db.base import new_uuid, utcnow_iso
from app.db.session import get_db
from app.models import Tree, TreeMembership, User
from app.schemas.tree import (
    TreeCreate,
    TreeMetadataOut,
    TreeOut,
    TreeStorageUsageOut,
    TreeUpdate,
)
from app.services.activity.activity import record_activity
from app.services.event_bus import event_bus, publish_tree_event, tree_audience
from app.services.storage import delete_tree_media
from app.services.storage_usage import compute_owner_usage, owner_quotas
from app.services.system.admin_audit import record_admin_audit
from app.services.tree_state import (
    bulk_tree_last_opened,
    mark_tree_opened,
    tree_last_opened,
)
from app.services.tree_transfer import within_undo_window
from app.services.tree_view import tree_out

router = APIRouter(prefix="/trees", tags=["trees"])


@router.get("", response_model=list[TreeOut])
def list_trees(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ids = explicit_tree_ids(db, user)
    trees = list(db.scalars(select(Tree).where(Tree.id.in_(ids))).all()) if ids else []
    # Each user has their own last-opened stamp per tree (#878) — bulk-fetch it
    # to avoid one query per tree.
    last_opened = bulk_tree_last_opened(db, ids, user.id)
    trees.sort(key=lambda t: (last_opened.get(t.id) or "", t.created_at), reverse=True)
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
    return [
        tree_out(db, t, user, counts.get(t.id, 0), last_opened.get(t.id))
        for t in trees
    ]


@router.post("", response_model=TreeOut, status_code=201)
def create_tree(
    payload: TreeCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tree = Tree(
        id=new_uuid(),
        name=payload.name,
        owner_id=user.id,
        created_at=utcnow_iso(),
    )
    db.add(tree)
    db.flush()
    mark_tree_opened(db, tree.id, user.id)
    record_activity(
        db, tree_id=tree.id, actor=user, action="create",
        target_type="tree", target_id=tree.id, target_label=tree.name,
    )
    db.commit()
    db.refresh(tree)
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    return tree_out(db, tree, user)


@router.get("/{tree_id}", response_model=TreeOut)
def get_tree(
    tree: Tree = Depends(get_readable_tree_public),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    # Selecting a tree counts as "opening" it (only for authenticated users).
    if user is not None:
        mark_tree_opened(db, tree.id, user.id)
        db.commit()
    return tree_out(db, tree, user)


@router.get("/{tree_id}/metadata", response_model=TreeMetadataOut)
def get_metadata(
    tree: Tree = Depends(get_readable_tree_public),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> TreeMetadataOut:
    return TreeMetadataOut(
        id=tree.id,
        name=tree.name,
        created_at=tree.created_at,
        last_opened=tree_last_opened(db, tree.id, user.id) if user is not None else None,
    )


@router.get("/{tree_id}/storage", response_model=TreeStorageUsageOut)
def get_storage_usage(
    tree: Tree = Depends(get_readable_tree),
    db: Session = Depends(get_db),
):
    """Return the tree owner's aggregate storage usage and quota limits."""
    usage = compute_owner_usage(db, tree.owner_id)
    quotas = owner_quotas(db, tree)
    return TreeStorageUsageOut(
        tree_bytes=usage["tree_bytes"],
        media_bytes=usage["media_bytes"],
        total_bytes=usage["total_bytes"],
        tree_quota_bytes=quotas["tree_quota_bytes"],
        media_quota_bytes=quotas["media_quota_bytes"],
    )


@router.patch("/{tree_id}", response_model=TreeOut)
def update_tree(
    payload: TreeUpdate,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    logged = False
    if payload.name is not None and payload.name != tree.name:
        old_name = tree.name
        tree.name = payload.name
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="tree", target_id=tree.id, target_label=tree.name,
            details={"before": {"name": old_name}, "after": {"name": tree.name}},
        )
        logged = True
    db.commit()
    db.refresh(tree)
    if logged:
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    return tree_out(db, tree, user)


@router.delete("/{tree_id}", status_code=204)
def delete_tree(
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can delete a tree")
    if within_undo_window(tree):
        raise HTTPException(
            status_code=409,
            detail=(
                "Ownership was recently transferred;"
                " deletion is blocked during the undo window."
            ),
        )
    tree_id = tree.id
    audience = tree_audience(db, tree)
    record_admin_audit(
        db,
        actor=user,
        action="delete",
        subject_type="tree",
        subject_id=tree.id,
        subject_label=tree.name,
    )
    db.delete(tree)
    db.commit()
    # The DB cascade clears the rows; remove the backing media files too.
    delete_tree_media(tree_id)
    event_bus.publish(audience, "tree.deleted", {"tree_id": tree_id})
