"""Tree lifecycle, sharing and metadata."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    explicit_tree_ids,
    get_current_user,
    get_current_user_optional,
    get_readable_tree,
    get_readable_tree_public,
    get_writable_tree,
    role_for,
)
from app.db.base import new_uuid, utcnow_iso
from app.db.session import SessionLocal, get_db
from app.models import Tree, TreeMembership, User
from app.models.family import Member
from app.schemas.extract import SubtreeExtractRequest, SubtreePreview
from app.schemas.job import JobStarted
from app.schemas.merge import TreeMergePreview, TreeMergePreviewRequest
from app.schemas.tree import (
    LinkGraphBridgeMember,
    LinkGraphEdge,
    LinkGraphNode,
    LinkGraphOut,
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
    TreeTransferResult,
    TreeUpdate,
)
from app.services import feature_service, friendships
from app.services.event_bus import event_bus, publish_tree_event, tree_audience
from app.services.extract import (
    compute_subtree_preview,
    extract_subtree,
    validate_move_request,
)
from app.services.feature_service import DEFAULT_RESTRICTIONS, RESTRICTABLE_DOMAINS
from app.services.job_service import ProgressCallback, create_job, run_job
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
    ids = explicit_tree_ids(db, user)
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


@router.post("/merge", response_model=JobStarted, status_code=202)
def merge(
    payload: TreeMerge,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="A name is required")
    job = create_job(db, user.id, "merge")
    background_tasks.add_task(
        run_job, job.id, user.id, _do_merge,
        user.id, payload.name, payload.source_a, payload.source_b, payload.resolutions,
    )
    return JobStarted(job_id=job.id)


def _do_merge(
    progress_cb: ProgressCallback,
    user_id: str,
    name: str,
    source_a: str,
    source_b: str | None,
    resolutions: list | None,
) -> str:
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        tree = merge_trees(db, user, name, source_a, source_b, resolutions, progress_cb)
        return tree.id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.post("/extract-subtree/preview", response_model=SubtreePreview)
def extract_subtree_preview(
    payload: SubtreeExtractRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compute a sub-tree extraction preview (no data is written)."""
    return compute_subtree_preview(db, user, payload)


@router.post("/extract-subtree", response_model=JobStarted, status_code=202)
def extract_subtree_endpoint(
    payload: SubtreeExtractRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="A name is required")
    # Surface precondition failures (direction, ownership, feature flag,
    # already-linked root) as 4xx responses instead of a failed job.
    validate_move_request(db, user, payload)
    job = create_job(db, user.id, "extract_subtree")
    background_tasks.add_task(run_job, job.id, user.id, _do_extract, user.id, payload)
    return JobStarted(job_id=job.id)


def _do_extract(
    progress_cb: ProgressCallback,
    user_id: str,
    payload: SubtreeExtractRequest,
) -> str:
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        tree = extract_subtree(db, user, payload, progress_cb)
        return tree.id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


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
    )


_LINK_GRAPH_MAX_DEPTH = 10
_LINK_GRAPH_MAX_NODES = 100
_LINK_GRAPH_MAX_BRIDGE_MEMBERS = 5


def _member_name(member: Member) -> str | None:
    return " ".join(filter(None, [member.first_name, member.last_name])) or None


@router.get("/{tree_id}/link-graph", response_model=LinkGraphOut)
def get_link_graph(
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Graph of trees reachable from this one via tree-in-tree member links.

    BFS over member.linked_tree_id starting at the current tree. Trees the
    requesting user cannot read become terminal placeholder nodes (no name,
    no member count, not expanded further) so nothing about them leaks.
    Bounded by depth and node-count caps; ``truncated`` is set when a cap
    stops expansion before the graph was fully explored.
    """
    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")

    def is_accessible(t: Tree) -> bool:
        return (
            user.is_admin
            or role_for(db, t, user) is not None
            or t.public_role == "viewer"
        )

    nodes: dict[str, LinkGraphNode] = {}
    edges: dict[tuple[str, str], LinkGraphEdge] = {}
    truncated = False

    member_count = db.scalar(
        select(func.count()).select_from(Member).where(Member.tree_id == tree.id)
    )
    nodes[tree.id] = LinkGraphNode(
        id=tree.id,
        name=tree.name,
        member_count=member_count or 0,
        role=role_for(db, tree, user),
        accessible=True,
        is_current=True,
    )

    # (tree, depth) frontier of accessible, expandable trees.
    frontier: list[tuple[Tree, int]] = [(tree, 0)]
    visited: set[str] = {tree.id}

    while frontier:
        current, depth = frontier.pop(0)
        if depth >= _LINK_GRAPH_MAX_DEPTH:
            truncated = True
            continue

        linked_members = db.scalars(
            select(Member)
            .where(Member.tree_id == current.id, Member.linked_tree_id.isnot(None))
            .order_by(Member.id)
        ).all()
        if not linked_members:
            continue

        by_target: dict[str, list[Member]] = {}
        for m in linked_members:
            by_target.setdefault(m.linked_tree_id, []).append(m)

        for target_id, members in by_target.items():
            edge_key = (current.id, target_id)
            edges[edge_key] = LinkGraphEdge(
                source_tree_id=current.id,
                target_tree_id=target_id,
                count=len(members),
                bridge_members=[
                    LinkGraphBridgeMember(id=m.id, name=_member_name(m))
                    for m in members[:_LINK_GRAPH_MAX_BRIDGE_MEMBERS]
                ],
            )

            if target_id in visited:
                continue

            if len(nodes) >= _LINK_GRAPH_MAX_NODES:
                truncated = True
                visited.add(target_id)
                continue

            visited.add(target_id)
            target = db.get(Tree, target_id)
            if target is None:
                nodes[target_id] = LinkGraphNode(
                    id=target_id,
                    name=None,
                    member_count=None,
                    role=None,
                    accessible=False,
                    is_current=False,
                )
                continue

            if not is_accessible(target):
                nodes[target_id] = LinkGraphNode(
                    id=target_id,
                    name=None,
                    member_count=None,
                    role=None,
                    accessible=False,
                    is_current=False,
                )
                continue

            target_count = db.scalar(
                select(func.count())
                .select_from(Member)
                .where(Member.tree_id == target.id)
            )
            nodes[target_id] = LinkGraphNode(
                id=target_id,
                name=target.name,
                member_count=target_count or 0,
                role=role_for(db, target, user),
                accessible=True,
                is_current=False,
            )
            frontier.append((target, depth + 1))

    return LinkGraphOut(
        nodes=list(nodes.values()), edges=list(edges.values()), truncated=truncated
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
    if _within_undo_window(tree):
        raise HTTPException(
            status_code=409,
            detail=(
                "Ownership was recently transferred;"
                " deletion is blocked during the undo window."
            ),
        )
    tree_id = tree.id
    audience = tree_audience(db, tree)
    db.delete(tree)
    db.commit()
    # The DB cascade clears the rows; remove the backing media files too.
    delete_tree_media(tree_id)
    event_bus.publish(audience, "tree.deleted", {"tree_id": tree_id})


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
    publish_tree_event(
        db, tree, "tree.access_changed", {"tree_id": tree.id}, extra_user_ids=[target.id]
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
        db.delete(membership)
        db.commit()
        publish_tree_event(
            db,
            tree,
            "tree.access_changed",
            {"tree_id": tree.id},
            extra_user_ids=[user_id],
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
    membership.restrictions = payload.restrictions or None
    db.commit()
    publish_tree_event(
        db,
        tree,
        "tree.access_changed",
        {"tree_id": tree.id},
        extra_user_ids=[user_id],
    )
    return list_access(tree=tree, db=db)


TRANSFER_UNDO_WINDOW_SECONDS = 60


def _undo_deadline(transferred_at: str) -> str:
    from datetime import UTC, datetime, timedelta

    dt = datetime.fromisoformat(transferred_at)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return (dt + timedelta(seconds=TRANSFER_UNDO_WINDOW_SECONDS)).isoformat()


def _within_undo_window(tree: Tree) -> bool:
    """Return True if the transfer undo window is still open."""
    from datetime import UTC, datetime

    if tree.previous_owner_id is None or tree.ownership_transferred_at is None:
        return False
    transferred_at = datetime.fromisoformat(tree.ownership_transferred_at)
    if transferred_at.tzinfo is None:
        transferred_at = transferred_at.replace(tzinfo=UTC)
    elapsed = (datetime.now(UTC) - transferred_at).total_seconds()
    return elapsed <= TRANSFER_UNDO_WINDOW_SECONDS


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

    db.commit()
    db.refresh(tree)
    publish_tree_event(
        db,
        tree,
        "tree.ownership_changed",
        {"tree_id": tree.id, "new_owner_id": tree.owner_id},
        extra_user_ids=[old_owner_id],
    )
    return TreeTransferResult(
        access=list_access(tree=tree, db=db),
        undo_available_until=_undo_deadline(tree.ownership_transferred_at),
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
    from datetime import UTC, datetime

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

    db.commit()
    db.refresh(tree)
    publish_tree_event(
        db,
        tree,
        "tree.ownership_changed",
        {"tree_id": tree.id, "new_owner_id": tree.owner_id},
        extra_user_ids=[reverted_from_owner_id],
    )
    return TreeTransferResult(
        access=list_access(tree=tree, db=db),
        undo_available_until=None,
    )

