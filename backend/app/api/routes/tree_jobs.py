"""Long-running tree workflows (merge, subtree extraction) and the tree-link graph."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_readable_tree
from app.core.exceptions import NotFoundError
from app.db.session import SessionLocal, get_db
from app.models import Tree, User
from app.schemas.extract import SubtreeExtractRequest, SubtreePreview
from app.schemas.job import JobStarted
from app.schemas.merge import TreeMergePreview, TreeMergePreviewRequest
from app.schemas.tree import LinkGraphOut, TreeMerge
from app.services.extract import (
    compute_subtree_preview,
    extract_subtree,
    validate_move_request,
)
from app.services.merge import compute_merge_preview, merge_trees
from app.services.system import feature_service
from app.services.system.job_service import ProgressCallback, create_job, run_job
from app.services.tree_links import compute_link_graph

router = APIRouter(prefix="/trees", tags=["trees"])


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
            raise NotFoundError("User not found")
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
            raise NotFoundError("User not found")
        tree = extract_subtree(db, user, payload, progress_cb)
        return tree.id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.get("/{tree_id}/link-graph", response_model=LinkGraphOut)
def get_link_graph(
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Graph of trees reachable from this one via tree-in-tree member links.

    See ``app.services.tree_links.compute_link_graph`` for the traversal.
    """
    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    return compute_link_graph(db, tree, user)
