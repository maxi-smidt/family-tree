"""Shared offset pagination + filtering for activity-log endpoints."""

import json
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
    "sources": {"document", "document_file"},
}

# Undo snapshots of other targets can carry a restricted domain's rows (a
# deleted person's citations quote documents). The snapshot keeps them for
# undo; responses drop them for people who may not see that domain.
SNAPSHOT_KEYS_BY_DOMAIN: dict[str, set[str]] = {
    "sources": {"citations", "citation_ids", "document_links"},
}


def hidden_activity_domains(
    db: Session, user: User, workspace_ids: Sequence[str]
) -> dict[str, set[str]]:
    """Return the areas the user may not see, per tree.

    Activity entries contain user-provided labels and undo snapshots, so
    merely hiding the source route is not enough: a restricted shared member
    could otherwise read the protected content from the audit trail. Owners
    and admins are unrestricted.
    """
    if user.is_admin or not workspace_ids:
        return {}

    memberships = db.scalars(
        select(WorkspaceMembership).where(
            WorkspaceMembership.user_id == user.id,
            WorkspaceMembership.workspace_id.in_(workspace_ids),
        )
    ).all()
    return {
        membership.workspace_id: set(membership.restrictions)
        for membership in memberships
        if membership.restrictions
    }


def _by_domain(
    hidden_domains: Mapping[str, set[str]], mapping: Mapping[str, set[str]]
) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for workspace_id, domains in hidden_domains.items():
        values = set().union(*(mapping.get(domain, set()) for domain in domains))
        if values:
            result[workspace_id] = values
    return result


def _redact_snapshot(details: str | None, keys: set[str]) -> str | None:
    """Drop ``keys`` from an entry's undo snapshot, if it has them."""
    if not details or not keys:
        return details
    try:
        parsed = json.loads(details)
    except ValueError:
        return details
    snapshot = parsed.get("snapshot") if isinstance(parsed, dict) else None
    if not isinstance(snapshot, dict) or not keys & snapshot.keys():
        return details
    for key in keys:
        snapshot.pop(key, None)
    return json.dumps(parsed)


def activity_page(
    db: Session,
    workspace_ids: Sequence[str],
    *,
    limit: int,
    offset: int,
    actor: str | None = None,
    action: str | None = None,
    target_type: str | None = None,
    hidden_domains: Mapping[str, set[str]] | None = None,
) -> ActivityPageOut:
    """Return one offset-based page of newest-first activity for ``workspace_ids``.

    ``total`` reflects the applied filters so callers can paginate the filtered
    set; ``actors`` lists the distinct actor usernames across the (unfiltered)
    workspaces so a filter dropdown stays complete regardless of the current page.
    """
    hidden_domains = hidden_domains or {}
    hidden_keys = _by_domain(hidden_domains, SNAPSHOT_KEYS_BY_DOMAIN)
    base_filters = [ActivityLog.workspace_id.in_(workspace_ids)]
    hidden_target_types = _by_domain(hidden_domains, ACTIVITY_TARGET_TYPES_BY_DOMAIN)
    for workspace_id, hidden_types in hidden_target_types.items():
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
        entries=[
            ActivityOut.model_validate(row).model_copy(
                update={
                    "details": _redact_snapshot(
                        row.details, hidden_keys.get(row.workspace_id, set())
                    )
                }
            )
            for row in rows
        ],
        total=total,
        actors=list(actors),
    )
