"""Public (unauthenticated) access to a tree: enable/disable, password gate."""

import math

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_tree
from app.core.rate_limit import public_unlock_rate_limiter
from app.core.security import (
    create_public_tree_token,
    hash_password,
    run_dummy_verify,
    verify_password,
)
from app.db.session import get_db
from app.models import Tree, User
from app.schemas.tree import (
    PublicAccessUpdate,
    PublicPasswordUpdate,
    PublicTreeUnlock,
    PublicTreeUnlockResult,
    TreeOut,
)
from app.services.activity.activity import record_activity
from app.services.event_bus import publish_tree_event
from app.services.system.admin_audit import record_admin_audit
from app.services.trees.tree_view import tree_out

router = APIRouter(prefix="/trees", tags=["trees"])


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
    old_public_role = tree.public_role
    tree.public_role = payload.public_role
    if tree.public_role is None:
        tree.public_password_hash = None
    logged = False
    if old_public_role != tree.public_role:
        tree.public_access_version += 1
        record_activity(
            db, tree_id=tree.id, actor=user, action="update",
            target_type="tree", target_id=tree.id, target_label=tree.name,
            details={
                "before": {"public_role": old_public_role},
                "after": {"public_role": tree.public_role},
            },
        )
        record_admin_audit(
            db, actor=user, action="update", subject_type="tree_public_access",
            subject_id=tree.id, subject_label=tree.name,
            details={
                "before": {"public_role": old_public_role},
                "after": {"public_role": tree.public_role},
            },
        )
        logged = True
    db.commit()
    db.refresh(tree)
    if logged:
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    return tree_out(db, tree, user)


@router.put("/{tree_id}/public/password", response_model=TreeOut)
def set_public_password(
    payload: PublicPasswordUpdate,
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Only the owner can change public access"
        )
    if tree.public_role != "viewer":
        raise HTTPException(
            status_code=400, detail="Tree is not publicly shared"
        )
    password = payload.password or ""
    tree.public_password_hash = hash_password(password) if password else None
    tree.public_access_version += 1
    record_admin_audit(
        db, actor=user, action="update", subject_type="tree_public_access",
        subject_id=tree.id, subject_label=tree.name,
        details={"password_protected": bool(password)},
    )
    db.commit()
    db.refresh(tree)
    return tree_out(db, tree, user)


@router.post("/{tree_id}/public/unlock", response_model=PublicTreeUnlockResult)
def unlock_public_tree(
    tree_id: str,
    payload: PublicTreeUnlock,
    request: Request,
    db: Session = Depends(get_db),
):
    """Anonymous: verify a public tree's password and return a short-lived
    unlock token to be sent as the X-Public-Tree-Token header."""
    client_ip = request.client.host if request.client else "unknown"
    limiter_key = f"{client_ip}:{tree_id}"
    retry_after = public_unlock_rate_limiter.retry_after(limiter_key)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many public unlock attempts",
            headers={"Retry-After": str(max(1, math.ceil(retry_after)))},
        )

    tree = db.get(Tree, tree_id)
    if (
        tree is None
        or tree.public_role != "viewer"
        or tree.public_password_hash is None
    ):
        # Run a dummy bcrypt verify so timing does not reveal whether the tree
        # exists / is protected, then answer uniformly.
        run_dummy_verify(payload.password)
        public_unlock_rate_limiter.record_failure(limiter_key)
        raise HTTPException(status_code=404, detail="Not found")
    if not verify_password(payload.password, tree.public_password_hash):
        public_unlock_rate_limiter.record_failure(limiter_key)
        raise HTTPException(status_code=401, detail="invalid_public_password")
    public_unlock_rate_limiter.reset(limiter_key)
    return PublicTreeUnlockResult(
        token=create_public_tree_token(tree.id, tree.public_access_version)
    )
