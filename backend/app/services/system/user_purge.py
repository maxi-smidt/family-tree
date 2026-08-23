"""Purge of users whose deletion grace period has elapsed.

A user scheduled for deletion (see [DELETE /users/{id}]) enters a pending state
with an absolute ``deletion_scheduled_for`` deadline. Once that deadline passes,
the account is permanently removed: the DB cascade (``workspaces.owner_id`` /
``tree_memberships`` ON DELETE CASCADE) clears every owned tree and its content,
and we remove the matching on-disk media first so no files are orphaned.

The work is split from the background loop ([deletion_sweeper]) so it can be
driven directly in tests with a controlled clock.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User, Workspace
from app.services.media.storage import delete_user_profile_media, delete_workspace_media
from app.services.system.admin_audit import record_admin_audit
from app.services.unit_of_work import UnitOfWork

logger = logging.getLogger("app.user_purge")


def find_due_users(db: Session, now: datetime | None = None) -> list[User]:
    """Pending-deletion users whose deadline is at or before ``now``."""
    moment = now or datetime.now(UTC)
    pending = db.scalars(
        select(User).where(User.deletion_scheduled_for.is_not(None))
    ).all()
    due: list[User] = []
    for user in pending:
        try:
            deadline = datetime.fromisoformat(user.deletion_scheduled_for)
        except ValueError:
            # A malformed timestamp shouldn't strand the account forever.
            logger.warning(
                "User %s has an unparseable deletion_scheduled_for %r; purging.",
                user.id,
                user.deletion_scheduled_for,
            )
            due.append(user)
            continue
        if deadline <= moment:
            due.append(user)
    return due


def purge_user(db: Session, user: User) -> None:
    """Permanently delete a user, their owned workspaces, and the workspaces' media."""
    workspace_ids = db.scalars(
        select(Workspace.id).where(Workspace.owner_id == user.id)
    ).all()
    user_id = user.id
    with UnitOfWork(db) as uow:
        record_admin_audit(
            db,
            actor=None,
            action="delete",
            subject_type="user",
            subject_id=user.id,
            subject_label=user.username,
            details={"purged_after_grace_period": True},
        )
        db.delete(user)
        # Remove files only once the row-level cascade has actually
        # committed — deleting them upfront would orphan a rolled-back
        # user's media on a failed commit.
        uow.after_commit(lambda: [delete_workspace_media(tid) for tid in workspace_ids])
        uow.after_commit(lambda: delete_user_profile_media(user_id))


def purge_due_users(db: Session, now: datetime | None = None) -> int:
    """Purge every due user. Returns how many were removed.

    Failures are isolated per user so one bad account can't stall the rest.
    """
    purged = 0
    for user in find_due_users(db, now):
        user_id = user.id
        try:
            purge_user(db, user)
            purged += 1
            logger.info("Purged user %s after deletion grace period.", user_id)
        except Exception:  # noqa: BLE001 - keep going for the remaining users
            # allowlisted-rollback: per-iteration isolation on a session shared
            # across this loop, not undoing purge_user's own UnitOfWork commit.
            db.rollback()
            logger.exception("Failed to purge user %s", user_id)
    return purged
