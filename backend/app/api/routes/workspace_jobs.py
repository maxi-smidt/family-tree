"""Long-running tree workflows (workspace merge)."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.exceptions import NotFoundError
from app.db.session import SessionLocal, get_db
from app.models import User
from app.schemas.job import JobStarted
from app.schemas.merge import WorkspaceMergePreview, WorkspaceMergePreviewRequest
from app.schemas.workspace import WorkspaceMerge
from app.services.system.job_service import ProgressCallback, create_job, run_job
from app.services.workspaces.merge import compute_merge_preview, merge_trees

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.post("/merge/preview", response_model=WorkspaceMergePreview)
def merge_preview(
    payload: WorkspaceMergePreviewRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compute a merge preview (no data is written)."""
    return compute_merge_preview(db, user, payload.source_a, payload.source_b)


@router.post("/merge", response_model=JobStarted, status_code=202)
def merge(
    payload: WorkspaceMerge,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="A name is required")
    job = create_job(db, user.id, "merge")
    background_tasks.add_task(
        run_job,
        job.id,
        user.id,
        _do_merge,
        user.id,
        payload.name,
        payload.source_a,
        payload.source_b,
        payload.resolutions,
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
        # allowlisted-rollback: this background job's own session — covers a
        # failure anywhere above, not just the callee's own UnitOfWork commit.
        db.rollback()
        raise
    finally:
        db.close()
