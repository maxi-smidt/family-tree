"""Public (unauthenticated) access to a tree: enable/disable, password gate."""

import math

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_workspace
from app.core.rate_limit import (
    public_unlock_aggregate_rate_limiter,
    public_unlock_rate_limiter,
)
from app.core.security import (
    create_public_tree_token,
    hash_password,
    run_dummy_verify,
    verify_password,
)
from app.db.session import get_db
from app.models import User, Workspace
from app.schemas.workspace import (
    PublicAccessUpdate,
    PublicPasswordUpdate,
    PublicWorkspaceUnlock,
    PublicWorkspaceUnlockResult,
    WorkspaceOut,
)
from app.services.activity.activity import record_activity
from app.services.event_bus import publish_workspace_event
from app.services.system.admin_audit import record_admin_audit
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.public_links import resolve_public_grant
from app.services.workspaces.workspace_view import tree_out

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.patch("/{workspace_id}/public", response_model=WorkspaceOut)
def set_public_access(
    payload: PublicAccessUpdate,
    tree: Workspace = Depends(get_readable_workspace),
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
    old_public_role = tree.public_role
    tree.public_role = payload.public_role
    if tree.public_role is None:
        tree.public_password_hash = None
    logged = False
    if old_public_role != tree.public_role:
        tree.public_access_version += 1
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="tree",
            target_id=tree.id,
            target_label=tree.name,
            details={
                "before": {"public_role": old_public_role},
                "after": {"public_role": tree.public_role},
            },
        )
        record_admin_audit(
            db,
            actor=user,
            action="update",
            subject_type="tree_public_access",
            subject_id=tree.id,
            subject_label=tree.name,
            details={
                "before": {"public_role": old_public_role},
                "after": {"public_role": tree.public_role},
            },
        )
        logged = True
    with UnitOfWork(db) as uow:
        if logged:
            uow.after_commit(
                lambda: publish_workspace_event(
                    db, tree, "activity.entry_added", {"workspace_id": tree.id}
                )
            )
    db.refresh(tree)
    return tree_out(db, tree, user)


@router.put("/{workspace_id}/public/password", response_model=WorkspaceOut)
def set_public_password(
    payload: PublicPasswordUpdate,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can change public access"
        )
    if tree.public_role != "viewer":
        raise HTTPException(status_code=400, detail="Workspace is not publicly shared")
    password = payload.password or ""
    with UnitOfWork(db):
        tree.public_password_hash = hash_password(password) if password else None
        tree.public_access_version += 1
        record_admin_audit(
            db,
            actor=user,
            action="update",
            subject_type="tree_public_access",
            subject_id=tree.id,
            subject_label=tree.name,
            details={"password_protected": bool(password)},
        )
    db.refresh(tree)
    return tree_out(db, tree, user)


@router.post("/{workspace_id}/public/unlock", response_model=PublicWorkspaceUnlockResult)
def unlock_public_tree(
    workspace_id: str,
    payload: PublicWorkspaceUnlock,
    request: Request,
    db: Session = Depends(get_db),
):
    """Anonymous: verify a public grant's password and return a short-lived
    unlock token to be sent as the X-Public-Workspace-Token header.

    ``payload.link_id`` selects which grant to attempt: the workspace-wide
    link (default), or one of this workspace's independent
    ``WorkspaceSectionPublicLink`` grants (#993) — each has its own password,
    so unlocking one never unlocks another.
    """
    client_ip = request.client.host if request.client else "unknown"
    limiter_key = f"{client_ip}:{workspace_id}:{payload.link_id or 'workspace'}"
    retry_after = public_unlock_rate_limiter.retry_after(limiter_key)
    aggregate_retry_after = public_unlock_aggregate_rate_limiter.retry_after(client_ip)
    if retry_after is not None or aggregate_retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many public unlock attempts",
            headers={
                "Retry-After": str(
                    max(1, math.ceil(max(retry_after or 0, aggregate_retry_after or 0)))
                )
            },
        )

    def _record_failure() -> None:
        public_unlock_rate_limiter.record_failure(limiter_key)
        public_unlock_aggregate_rate_limiter.record_failure(client_ip)

    tree = db.get(Workspace, workspace_id)
    grant = resolve_public_grant(db, tree, payload.link_id) if tree else None
    if grant is None or grant.password_hash is None:
        # Run a dummy bcrypt verify so timing does not reveal whether the
        # workspace/grant exists or is protected, then answer uniformly.
        run_dummy_verify(payload.password)
        _record_failure()
        raise HTTPException(status_code=404, detail="Not found")
    if not verify_password(payload.password, grant.password_hash):
        _record_failure()
        raise HTTPException(status_code=401, detail="invalid_public_password")
    public_unlock_rate_limiter.reset(limiter_key)
    public_unlock_aggregate_rate_limiter.reset(client_ip)
    return PublicWorkspaceUnlockResult(
        token=create_public_tree_token(tree.id, grant.access_version, grant.id)
    )
