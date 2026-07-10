"""Shared offset pagination + filtering for activity-log endpoints."""

from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.activity import ActivityLog
from app.schemas.activity import ActivityOut, ActivityPageOut


def activity_page(
    db: Session,
    tree_ids: Sequence[str],
    *,
    limit: int,
    offset: int,
    actor: str | None = None,
    action: str | None = None,
    target_type: str | None = None,
) -> ActivityPageOut:
    """Return one offset-based page of newest-first activity for ``tree_ids``.

    ``total`` reflects the applied filters so callers can paginate the filtered
    set; ``actors`` lists the distinct actor usernames across the (unfiltered)
    trees so a filter dropdown stays complete regardless of the current page.
    """
    filters = [ActivityLog.tree_id.in_(tree_ids)]
    if actor:
        filters.append(ActivityLog.actor_username == actor)
    if action:
        filters.append(ActivityLog.action == action)
    if target_type:
        filters.append(ActivityLog.target_type == target_type)

    total = db.scalar(select(func.count()).select_from(ActivityLog).where(*filters)) or 0

    rows = db.scalars(
        select(ActivityLog)
        .where(*filters)
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    actors = db.scalars(
        select(ActivityLog.actor_username)
        .where(
            ActivityLog.tree_id.in_(tree_ids),
            ActivityLog.actor_username.is_not(None),
        )
        .distinct()
        .order_by(ActivityLog.actor_username)
    ).all()

    return ActivityPageOut(
        entries=[ActivityOut.model_validate(row) for row in rows],
        total=total,
        actors=list(actors),
    )
