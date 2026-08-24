"""Workspace lifecycle: create, list, read, update, delete."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    explicit_workspace_ids,
    get_current_user,
    get_current_user_optional,
    get_readable_workspace,
    get_readable_workspace_public,
    get_writable_workspace,
)
from app.db.base import new_uuid, utcnow_iso
from app.db.session import get_db
from app.models import User, Workspace, WorkspaceMembership
from app.schemas.workspace import (
    WorkspaceCreate,
    WorkspaceMetadataOut,
    WorkspaceOut,
    WorkspaceStorageUsageOut,
    WorkspaceUpdate,
)
from app.services.activity.activity import record_activity
from app.services.event_bus import event_bus, publish_workspace_event, workspace_audience
from app.services.media.storage import delete_workspace_media
from app.services.media.storage_usage import compute_owner_usage, owner_quotas
from app.services.system.admin_audit import record_admin_audit
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.workspace_state import (
    bulk_workspace_last_opened,
    mark_workspace_opened,
    workspace_last_opened,
)
from app.services.workspaces.workspace_transfer import within_undo_window
from app.services.workspaces.workspace_view import tree_out

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=list[WorkspaceOut])
def list_trees(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ids = explicit_workspace_ids(db, user)
    workspaces = (
        list(db.scalars(select(Workspace).where(Workspace.id.in_(ids))).all())
        if ids
        else []
    )
    # Each user has their own last-opened stamp per tree (#878) — bulk-fetch it
    # to avoid one query per tree.
    last_opened = bulk_workspace_last_opened(db, ids, user.id)
    workspaces.sort(
        key=lambda t: (last_opened.get(t.id) or "", t.created_at), reverse=True
    )
    # Bulk-count memberships to avoid one query per tree.
    counts: dict[str, int] = (
        dict(
            db.execute(
                select(WorkspaceMembership.workspace_id, func.count())
                .where(WorkspaceMembership.workspace_id.in_(ids))
                .group_by(WorkspaceMembership.workspace_id)
            ).all()
        )
        if ids
        else {}
    )
    return [
        tree_out(db, t, user, counts.get(t.id, 0), last_opened.get(t.id))
        for t in workspaces
    ]


@router.post("", response_model=WorkspaceOut, status_code=201)
def create_tree(
    payload: WorkspaceCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tree = Workspace(
        id=new_uuid(),
        name=payload.name,
        owner_id=user.id,
        created_at=utcnow_iso(),
    )
    with UnitOfWork(db) as uow:
        db.add(tree)
        db.flush()
        mark_workspace_opened(db, tree.id, user.id)
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="create",
            target_type="tree",
            target_id=tree.id,
            target_label=tree.name,
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
    db.refresh(tree)
    return tree_out(db, tree, user)


@router.get("/{workspace_id}", response_model=WorkspaceOut)
def get_tree(
    tree: Workspace = Depends(get_readable_workspace_public),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    # Selecting a tree counts as "opening" it (only for authenticated users).
    if user is not None:
        with UnitOfWork(db):
            mark_workspace_opened(db, tree.id, user.id)
    return tree_out(db, tree, user)


@router.get("/{workspace_id}/metadata", response_model=WorkspaceMetadataOut)
def get_metadata(
    tree: Workspace = Depends(get_readable_workspace_public),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> WorkspaceMetadataOut:
    return WorkspaceMetadataOut(
        id=tree.id,
        name=tree.name,
        created_at=tree.created_at,
        last_opened=workspace_last_opened(db, tree.id, user.id)
        if user is not None
        else None,
    )


@router.get("/{workspace_id}/storage", response_model=WorkspaceStorageUsageOut)
def get_storage_usage(
    tree: Workspace = Depends(get_readable_workspace),
    db: Session = Depends(get_db),
):
    """Return the tree owner's aggregate storage usage and quota limits."""
    usage = compute_owner_usage(db, tree.owner_id)
    quotas = owner_quotas(db, tree)
    return WorkspaceStorageUsageOut(
        tree_bytes=usage["tree_bytes"],
        media_bytes=usage["media_bytes"],
        total_bytes=usage["total_bytes"],
        tree_quota_bytes=quotas["tree_quota_bytes"],
        media_quota_bytes=quotas["media_quota_bytes"],
    )


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
def update_tree(
    payload: WorkspaceUpdate,
    tree: Workspace = Depends(get_writable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with UnitOfWork(db) as uow:
        if payload.name is not None and payload.name != tree.name:
            old_name = tree.name
            tree.name = payload.name
            record_activity(
                db,
                workspace_id=tree.id,
                actor=user,
                action="update",
                target_type="tree",
                target_id=tree.id,
                target_label=tree.name,
                details={"before": {"name": old_name}, "after": {"name": tree.name}},
            )
            uow.after_commit(
                lambda: publish_workspace_event(
                    db, tree, "activity.entry_added", {"workspace_id": tree.id}
                )
            )
    db.refresh(tree)
    return tree_out(db, tree, user)


@router.delete("/{workspace_id}", status_code=204)
def delete_tree(
    tree: Workspace = Depends(get_readable_workspace),
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
    workspace_id = tree.id
    audience = workspace_audience(db, tree)
    with UnitOfWork(db) as uow:
        record_admin_audit(
            db,
            actor=user,
            action="delete",
            subject_type="tree",
            subject_id=tree.id,
            subject_label=tree.name,
        )
        db.delete(tree)
        # The DB cascade clears the rows; remove the backing media files too.
        uow.after_commit(lambda: delete_workspace_media(workspace_id))
        uow.after_commit(
            lambda: event_bus.publish(
                audience, "workspace.deleted", {"workspace_id": workspace_id}
            )
        )
