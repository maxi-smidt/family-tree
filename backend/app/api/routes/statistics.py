"""Statistics endpoint — aggregate insights for a family tree."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_readable_workspace
from app.db.session import get_db
from app.models import Workspace
from app.models.family import Member
from app.schemas.statistics import StatisticsReport
from app.services.cache import (
    STATS_TTL_SECONDS,
    cache_get_json,
    cache_set_json,
    stats_key,
)
from app.services.workspaces.statistics import compute_statistics

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["statistics"],
)

def _load_and_compute(db: Session, workspace_id: str) -> StatisticsReport:
    """Query the tree's members and build the report (blocking, sync).

    Kept separate so the route can run it in the threadpool — the DB query
    and the O(n) aggregation must not block the event loop.
    """
    members = list(
        db.scalars(select(Member).where(Member.workspace_id == workspace_id)).all()
    )
    return compute_statistics(members, workspace_id)


@router.get("/statistics", response_model=StatisticsReport)
async def get_statistics(
    tree: Workspace = Depends(get_readable_workspace),
    db: Session = Depends(get_db),
) -> StatisticsReport:
    """Return aggregate statistics for the tree. Read-only, scoped by workspace_id.

    When Redis is configured the result is cached per tree for
    ``STATS_TTL_SECONDS`` seconds and invalidated on member/relation writes.
    When Redis is not configured the statistics are always recomputed — the
    original behaviour is preserved exactly.
    """
    key = stats_key(tree.id)

    # --- cache hit -----------------------------------------------------------
    cached = await cache_get_json(key)
    if cached is not None:
        try:
            return StatisticsReport.model_validate(cached)
        except Exception:
            # Corrupt cached value — fall through and recompute.
            pass

    # --- cache miss: query DB and compute ------------------------------------
    # Run the blocking DB query + aggregation in the threadpool so the event
    # loop stays free (this is the hot path when Redis is not configured).
    report = await run_in_threadpool(_load_and_compute, db, tree.id)

    # Store the result; failures are silently swallowed inside cache_set_json.
    await cache_set_json(key, report.model_dump(mode="json"), STATS_TTL_SECONDS)

    return report
