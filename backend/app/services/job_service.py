"""Background-job runner with SSE progress streaming.

Each long-running operation (import, merge, extract-subtree) creates a
``BackgroundJob`` row, then runs in a Starlette background task (sync, off
the event loop via run_in_threadpool).  A ``progress_cb`` emits
``job.progress`` SSE events throughout; terminal ``job.done`` / ``job.failed``
events close the operation client-side.

Two separate DB sessions are used deliberately:
- ``job_db``: only writes ``BackgroundJob`` rows (progress_pct, status).
  Its commits never roll back due to work-side errors.
- The operation function (``fn``) opens its own session for tree data so
  a failed import can be rolled back cleanly without touching the job row.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException

from app.db.base import utcnow_iso
from app.db.session import SessionLocal
from app.models.job import BackgroundJob
from app.services.event_bus import event_bus

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[int], None]


def create_job(db: Any, user_id: str, job_type: str) -> BackgroundJob:
    """Create a BackgroundJob in the request's DB session and commit it."""
    job = BackgroundJob(user_id=user_id, type=job_type)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def run_job(
    job_id: str,
    user_id: str,
    fn: Callable[..., str],
    *args: Any,
    **kwargs: Any,
) -> None:
    """Run fn(progress_cb, *args, **kwargs) and track it as a background job.

    Called from a Starlette background task (runs in a threadpool thread).
    fn must return the result_tree_id (str) on success and raise on failure.
    fn is responsible for its own DB session.
    """
    job_db = SessionLocal()
    job = None
    try:
        job = job_db.get(BackgroundJob, job_id)
        if job is None:
            return
        job.status = "running"
        job.updated_at = utcnow_iso()
        job_db.commit()

        def progress_cb(pct: int) -> None:
            # Update in-memory only; avoid DB commit here because the operation
            # function may have an open write transaction on a separate session.
            # Final status (done/failed) is committed after the operation.
            job.progress_pct = pct
            job.updated_at = utcnow_iso()
            event_bus.publish([user_id], "job.progress", {"job_id": job_id, "pct": pct})

        result_tree_id: str = fn(progress_cb, *args, **kwargs)

        job.status = "done"
        job.progress_pct = 100
        job.result_tree_id = result_tree_id
        job.updated_at = utcnow_iso()
        job_db.commit()
        event_bus.publish(
            [user_id], "job.done", {"job_id": job_id, "tree_id": result_tree_id}
        )

    except Exception as exc:
        logger.exception("Background job %s failed", job_id)
        error_msg = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        try:
            job_db.rollback()
            if job is not None:
                job.status = "failed"
                job.error = error_msg
                job.updated_at = utcnow_iso()
                job_db.commit()
        except Exception:
            logger.exception("Failed to persist job failure for %s", job_id)
        event_bus.publish([user_id], "job.failed", {"job_id": job_id, "error": error_msg})

    finally:
        job_db.close()
