"""Ownership transfer, with a short undo window."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_tree
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import Tree, TreeMembership, User
from app.schemas.tree import TreeTransfer, TreeTransferResult
from app.services.activity.activity import record_activity
from app.services.collaboration import friendships
from app.services.event_bus import publish_tree_event
from app.services.trees.tree_access import list_tree_access
from app.services.trees.tree_transfer import TRANSFER_UNDO_WINDOW_SECONDS, undo_deadline
from app.services.unit_of_work import UnitOfWork

router = APIRouter(prefix="/trees", tags=["trees"])


@router.post("/{tree_id}/transfer", response_model=TreeTransferResult)
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

    Pass ``retain_role`` to keep the previous owner as a viewer or editor.
    Returns ``undo_available_until`` so the frontend can show a timed undo.
    """
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can transfer a tree"
        )

    _VALID_RETAIN = {"viewer", "editor"}
    if payload.retain_role is not None and payload.retain_role not in _VALID_RETAIN:
        raise HTTPException(
            status_code=400, detail="retain_role must be 'viewer', 'editor', or null"
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

    old_owner_id = tree.owner_id
    tree.owner_id = target.id
    tree.previous_owner_id = old_owner_id
    tree.ownership_transferred_at = utcnow_iso()

    membership = db.get(TreeMembership, (tree.id, target.id))
    if membership is not None:
        db.delete(membership)

    if payload.retain_role is not None:
        existing = db.get(TreeMembership, (tree.id, old_owner_id))
        if existing is None:
            db.add(
                TreeMembership(
                    tree_id=tree.id, user_id=old_owner_id, role=payload.retain_role
                )
            )
        else:
            existing.role = payload.retain_role

    record_activity(
        db, tree_id=tree.id, actor=user, action="update",
        target_type="tree", target_id=tree.id, target_label=tree.name,
        details={
            "before": {"owner_id": old_owner_id},
            "after": {"owner_id": tree.owner_id},
        },
    )
    with UnitOfWork(db) as uow:
        uow.after_commit(lambda: db.refresh(tree))
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db,
                tree,
                "tree.ownership_changed",
                {"tree_id": tree.id, "new_owner_id": tree.owner_id},
                extra_user_ids=[old_owner_id],
            )
        )
    return TreeTransferResult(
        access=list_tree_access(db, tree),
        undo_available_until=undo_deadline(tree.ownership_transferred_at),
    )


@router.post("/{tree_id}/transfer/revert", response_model=TreeTransferResult)
def revert_transfer(
    tree_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revert a recent ownership transfer within the undo window.

    Only the previous owner (or an admin) may call this. Does not depend on
    get_readable_tree because the previous owner may have no membership after
    the transfer.
    """
    tree = db.get(Tree, tree_id)
    if tree is None:
        raise HTTPException(status_code=404, detail="Tree not found")

    if tree.previous_owner_id is None or tree.ownership_transferred_at is None:
        raise HTTPException(status_code=400, detail="No transfer to undo")

    if user.id != tree.previous_owner_id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Not authorised to revert this transfer"
        )

    transferred_at = datetime.fromisoformat(tree.ownership_transferred_at)
    if transferred_at.tzinfo is None:
        transferred_at = transferred_at.replace(tzinfo=UTC)
    elapsed = (datetime.now(UTC) - transferred_at).total_seconds()
    if elapsed > TRANSFER_UNDO_WINDOW_SECONDS:
        raise HTTPException(status_code=410, detail="Undo window has expired")

    # Remove retained-access membership the previous owner may have received.
    old_membership = db.get(TreeMembership, (tree.id, tree.previous_owner_id))
    if old_membership is not None:
        db.delete(old_membership)

    reverted_from_owner_id = tree.owner_id
    tree.owner_id = tree.previous_owner_id
    tree.previous_owner_id = None
    tree.ownership_transferred_at = None

    record_activity(
        db, tree_id=tree.id, actor=user, action="update",
        target_type="tree", target_id=tree.id, target_label=tree.name,
        details={
            "before": {"owner_id": reverted_from_owner_id},
            "after": {"owner_id": tree.owner_id},
        },
    )
    with UnitOfWork(db) as uow:
        uow.after_commit(lambda: db.refresh(tree))
        uow.after_commit(
            lambda: publish_tree_event(
                db, tree, "activity.entry_added", {"tree_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_tree_event(
                db,
                tree,
                "tree.ownership_changed",
                {"tree_id": tree.id, "new_owner_id": tree.owner_id},
                extra_user_ids=[reverted_from_owner_id],
            )
        )
    return TreeTransferResult(
        access=list_tree_access(db, tree),
        undo_available_until=None,
    )
