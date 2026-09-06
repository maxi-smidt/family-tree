"""Shared offset pagination + filtering for activity-log endpoints."""

from collections.abc import Mapping, Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import User, WorkspaceMembership
from app.models.activity import ActivityLog
from app.schemas.activity import ActivityOut, ActivityPageOut

# A restricted content domain must not leak through the activity-log metadata.
# Add a target type here when a new restrictable domain begins recording its own
# activity rows.
ACTIVITY_TARGET_TYPES_BY_DOMAIN: dict[str, set[str]] = {
    "tasks": {"task"},
}


def hidden_activity_target_types(
    db: Session, user: User, workspace_ids: Sequence[str]
) -> dict[str, set[str]]:
    """Return activity target types the user is not allowed to see per tree.

    Activity entries contain user-provided labels, so merely hiding the source
    route is not enough: a restricted shared member could otherwise infer the
    protected content from the audit trail. Owners and admins are unrestricted.
    """
    if user.is_admin or not workspace_ids:
        return {}

    memberships = db.scalars(
        select(WorkspaceMembership).where(
            WorkspaceMembership.user_id == user.id,
            WorkspaceMembership.workspace_id.in_(workspace_ids),
        )
    ).all()
    hidden: dict[str, set[str]] = {}
    for membership in memberships:
        target_types: set[str] = set()
        for domain in membership.restrictions or []:
            target_types.update(ACTIVITY_TARGET_TYPES_BY_DOMAIN.get(domain, set()))
        if target_types:
            hidden[membership.workspace_id] = target_types
    return hidden


def activity_page(
    db: Session,
    workspace_ids: Sequence[str],
    *,
    limit: int,
    offset: int,
    actor: str | None = None,
    action: str | None = None,
    target_type: str | None = None,
    hidden_target_types: Mapping[str, set[str]] | None = None,
) -> ActivityPageOut:
    """Return one offset-based page of newest-first activity for ``workspace_ids``.

    ``total`` reflects the applied filters so callers can paginate the filtered
    set; ``actors`` lists the distinct actor usernames across the (unfiltered)
    workspaces so a filter dropdown stays complete regardless of the current page.
    """
    base_filters = [ActivityLog.workspace_id.in_(workspace_ids)]
    for workspace_id, hidden_types in (hidden_target_types or {}).items():
        if hidden_types:
            base_filters.append(
                or_(
                    ActivityLog.workspace_id != workspace_id,
                    ActivityLog.target_type.not_in(hidden_types),
                )
            )

    filters = list(base_filters)
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
            *base_filters,
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
