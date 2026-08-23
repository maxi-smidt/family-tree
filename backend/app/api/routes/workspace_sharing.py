"""Sharing a tree with other users: access grants, restrictions, batch ops."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_workspace
from app.db.session import get_db
from app.models import User, Workspace, WorkspaceMembership
from app.models.family import Member
from app.schemas.notification import WorkspaceSharedPayload, WorkspaceUnsharedPayload
from app.schemas.workspace import (
    LinkedShareWorkspaceOut,
    MemberRestrictionsUpdate,
    ShareCandidate,
    WorkspaceAccessBatchRevoke,
    WorkspaceMemberOut,
    WorkspaceShare,
    WorkspaceShareBatch,
)
from app.services.activity.activity import record_activity
from app.services.collaboration import friendships, notification_service
from app.services.event_bus import publish_workspace_event
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.restrictions import (
    DEFAULT_RESTRICTIONS,
    RESTRICTABLE_DOMAINS,
)
from app.services.workspaces.workspace_access import list_tree_access
from app.services.workspaces.workspace_links import reachable_linked_trees

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

_BATCH_TREE_IDS_MAX = 100


@router.get("/{workspace_id}/access", response_model=list[WorkspaceMemberOut])
def list_access(
    tree: Workspace = Depends(get_readable_workspace),
    db: Session = Depends(get_db),
):
    return list_tree_access(db, tree)


@router.get("/{workspace_id}/access/candidates", response_model=list[ShareCandidate])
def list_share_candidates(
    tree: Workspace = Depends(get_readable_workspace),
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
            select(WorkspaceMembership.user_id).where(
                WorkspaceMembership.workspace_id == tree.id
            )
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


@router.post("/{workspace_id}/access", response_model=list[WorkspaceMemberOut])
def share_tree(
    payload: WorkspaceShare,
    tree: Workspace = Depends(get_readable_workspace),
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
        raise HTTPException(status_code=403, detail="You can only share with friends")

    membership = db.get(WorkspaceMembership, (tree.id, target.id))
    is_new_grant = membership is None
    if membership is None:
        db.add(
            WorkspaceMembership(
                workspace_id=tree.id,
                user_id=target.id,
                role=payload.role,
                restrictions=DEFAULT_RESTRICTIONS,
            )
        )
    else:
        membership.role = payload.role
    if is_new_grant:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="create",
            target_type="share",
            target_id=target.id,
            target_label=target.username,
            details={"role": payload.role},
        )
    with UnitOfWork(db) as uow:
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.access_changed",
                {"workspace_id": tree.id},
                extra_user_ids=[target.id],
            )
        )
        if is_new_grant:
            uow.after_commit(
                lambda: publish_workspace_event(
                    db, tree, "activity.entry_added", {"workspace_id": tree.id}
                )
            )
            uow.after_commit(
                lambda: notification_service.create_notification(
                    db,
                    target.id,
                    "tree_shared",
                    WorkspaceSharedPayload(
                        workspace_id=tree.id,
                        workspace_name=tree.name,
                        role=payload.role,
                        actor_username=user.username,
                    ),
                )
            )
    return list_access(tree=tree, db=db)


@router.delete("/{workspace_id}/access/{user_id}", status_code=204)
def revoke_access(
    user_id: str,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can manage sharing")
    membership = db.get(WorkspaceMembership, (tree.id, user_id))
    if membership is not None:
        revoked_user = db.get(User, user_id)
        db.delete(membership)
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="delete",
            target_type="share",
            target_id=user_id,
            target_label=revoked_user.username if revoked_user else None,
        )
        with UnitOfWork(db) as uow:
            uow.after_commit(
                lambda: publish_workspace_event(
                    db,
                    tree,
                    "workspace.access_changed",
                    {"workspace_id": tree.id},
                    extra_user_ids=[user_id],
                )
            )
            uow.after_commit(
                lambda: publish_workspace_event(
                    db, tree, "activity.entry_added", {"workspace_id": tree.id}
                )
            )
            uow.after_commit(
                lambda: notification_service.create_notification(
                    db,
                    user_id,
                    "tree_unshared",
                    WorkspaceUnsharedPayload(
                        workspace_id=tree.id, workspace_name=tree.name
                    ),
                )
            )


@router.get(
    "/{workspace_id}/access/linked-workspaces",
    response_model=list[LinkedShareWorkspaceOut],
)
def list_linked_share_trees(
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    username: str | None = None,
):
    """Trees reachable from this one via member links, for the batch-share UI.

    Convenience listing only: it never grants anything by itself. Excludes the
    anchor tree. Readable-but-not-owned linked workspaces are still included (with
    ``manageable=False``) so the UI can show them as "can't be offered" rather
    than silently omitting them; workspaces the actor cannot read at all are
    skipped so their existence isn't leaked.
    """
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can share a tree")

    target_user: User | None = None
    if username is not None:
        target_user = db.scalar(select(User).where(User.username == username))
        if target_user is None:
            raise HTTPException(status_code=404, detail="User not found")

    linked = reachable_linked_trees(db, tree, user)
    result: list[LinkedShareWorkspaceOut] = []
    for t in linked:
        member_count = (
            db.scalar(
                select(func.count())
                .select_from(Member)
                .where(Member.workspace_id == t.id)
            )
            or 0
        )
        manageable = t.owner_id == user.id or user.is_admin
        target_role: str | None = None
        if target_user is not None:
            if t.owner_id == target_user.id:
                target_role = "owner"
            else:
                membership = db.get(WorkspaceMembership, (t.id, target_user.id))
                target_role = membership.role if membership else None
        result.append(
            LinkedShareWorkspaceOut(
                workspace_id=t.id,
                name=t.name,
                member_count=member_count,
                manageable=manageable,
                target_role=target_role,
            )
        )
    return result


@router.post("/{workspace_id}/access/batch", response_model=list[WorkspaceMemberOut])
def share_trees_batch(
    payload: WorkspaceShareBatch,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Grant one user the same role across the anchor tree and a batch of
    (typically linked) workspaces in a single call. All-or-nothing: every workspace_id
    is validated before any grant is applied."""
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can share a tree")
    if payload.role not in ("viewer", "editor"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if len(payload.workspace_ids) > _BATCH_TREE_IDS_MAX:
        raise HTTPException(status_code=400, detail="Too many workspaces")

    target = db.scalar(select(User).where(User.username == payload.username))
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    workspaces: list[Workspace] = []
    for workspace_id in payload.workspace_ids:
        t = db.get(Workspace, workspace_id)
        if t is None:
            raise HTTPException(status_code=404, detail="Workspace not found")
        if t.owner_id != user.id and not user.is_admin:
            raise HTTPException(status_code=403, detail="Only the owner can share a tree")
        if target.id == t.owner_id:
            raise HTTPException(status_code=400, detail="User already owns this tree")
        if not user.is_admin and not friendships.are_friends(db, t.owner_id, target.id):
            raise HTTPException(status_code=403, detail="You can only share with friends")
        workspaces.append(t)

    logged_trees: list[Workspace] = []
    for t in workspaces:
        membership = db.get(WorkspaceMembership, (t.id, target.id))
        is_new_grant = membership is None
        if membership is None:
            db.add(
                WorkspaceMembership(
                    workspace_id=t.id,
                    user_id=target.id,
                    role=payload.role,
                    restrictions=DEFAULT_RESTRICTIONS,
                )
            )
        else:
            membership.role = payload.role
        if is_new_grant:
            record_activity(
                db,
                workspace_id=t.id,
                actor=user,
                action="create",
                target_type="share",
                target_id=target.id,
                target_label=target.username,
                details={"role": payload.role},
            )
            logged_trees.append(t)

    with UnitOfWork(db) as uow:
        for t in workspaces:
            uow.after_commit(
                lambda t=t: publish_workspace_event(
                    db,
                    t,
                    "workspace.access_changed",
                    {"workspace_id": t.id},
                    extra_user_ids=[target.id],
                )
            )
        for t in logged_trees:
            uow.after_commit(
                lambda t=t: publish_workspace_event(
                    db, t, "activity.entry_added", {"workspace_id": t.id}
                )
            )
            uow.after_commit(
                lambda t=t: notification_service.create_notification(
                    db,
                    target.id,
                    "tree_shared",
                    WorkspaceSharedPayload(
                        workspace_id=t.id,
                        workspace_name=t.name,
                        role=payload.role,
                        actor_username=user.username,
                    ),
                )
            )
    return list_access(tree=tree, db=db)


@router.post("/{workspace_id}/access/batch-revoke", status_code=204)
def revoke_access_batch(
    payload: WorkspaceAccessBatchRevoke,
    tree: Workspace = Depends(get_readable_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke one user's access across a batch of (typically linked) workspaces in
    a single call. Trees without an existing membership for the user are
    silently skipped."""
    if tree.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can manage sharing")
    if len(payload.workspace_ids) > _BATCH_TREE_IDS_MAX:
        raise HTTPException(status_code=400, detail="Too many workspaces")

    workspaces: list[Workspace] = []
    for workspace_id in payload.workspace_ids:
        t = db.get(Workspace, workspace_id)
        if t is None:
            raise HTTPException(status_code=404, detail="Workspace not found")
        if t.owner_id != user.id and not user.is_admin:
            raise HTTPException(
                status_code=403, detail="Only the owner can manage sharing"
            )
        workspaces.append(t)

    revoked_user = db.get(User, payload.user_id)
    affected: list[Workspace] = []
    for t in workspaces:
        membership = db.get(WorkspaceMembership, (t.id, payload.user_id))
        if membership is not None:
            db.delete(membership)
            record_activity(
                db,
                workspace_id=t.id,
                actor=user,
                action="delete",
                target_type="share",
                target_id=payload.user_id,
                target_label=revoked_user.username if revoked_user else None,
            )
            affected.append(t)

    with UnitOfWork(db) as uow:
        for t in affected:
            uow.after_commit(
                lambda t=t: publish_workspace_event(
                    db,
                    t,
                    "workspace.access_changed",
                    {"workspace_id": t.id},
                    extra_user_ids=[payload.user_id],
                )
            )
            uow.after_commit(
                lambda t=t: publish_workspace_event(
                    db, t, "activity.entry_added", {"workspace_id": t.id}
                )
            )
            uow.after_commit(
                lambda t=t: notification_service.create_notification(
                    db,
                    payload.user_id,
                    "tree_unshared",
                    WorkspaceUnsharedPayload(workspace_id=t.id, workspace_name=t.name),
                )
            )


@router.patch(
    "/{workspace_id}/access/{user_id}/restrictions",
    response_model=list[WorkspaceMemberOut],
)
def update_member_restrictions(
    user_id: str,
    payload: MemberRestrictionsUpdate,
    tree: Workspace = Depends(get_readable_workspace),
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
    membership = db.get(WorkspaceMembership, (tree.id, user_id))
    if membership is None:
        raise HTTPException(status_code=404, detail="Membership not found")
    before_restrictions = list(membership.restrictions or [])
    membership.restrictions = payload.restrictions or None
    after_restrictions = list(membership.restrictions or [])
    target_user = db.get(User, user_id)
    logged = before_restrictions != after_restrictions
    if logged:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="share",
            target_id=user_id,
            target_label=target_user.username if target_user else None,
            details={
                "before": {"restrictions": before_restrictions},
                "after": {"restrictions": after_restrictions},
            },
        )
    with UnitOfWork(db) as uow:
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.access_changed",
                {"workspace_id": tree.id},
                extra_user_ids=[user_id],
            )
        )
        if logged:
            uow.after_commit(
                lambda: publish_workspace_event(
                    db, tree, "activity.entry_added", {"workspace_id": tree.id}
                )
            )
    return list_access(tree=tree, db=db)
