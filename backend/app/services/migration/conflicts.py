"""Pending migration review conflicts (#997): bridge-merge conflicts and
virtual-view match suggestions surfaced for owner review.

Resolving records the decision using the same field-choice shape as the
existing merge assistant (``app.schemas.merge.MergeResolution``); applying a
"merge" resolution to the underlying ``Member`` rows is #1018's job — this
only makes the decision durable and exactly-once.
"""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.core.exceptions import (
    AccessDeniedError,
    ConflictError,
    InvalidInputError,
    NotFoundError,
)
from app.db.base import utcnow_iso
from app.models.migration import MigrationConflict, MigrationConflictStatus
from app.models.user import User
from app.services.unit_of_work import UnitOfWork


def get_conflict_for_owner(
    db: Session, conflict_id: str, user: User
) -> MigrationConflict:
    conflict = db.get(MigrationConflict, conflict_id)
    if conflict is None:
        raise NotFoundError("Migration conflict not found")
    if conflict.owner_user_id != user.id and not user.is_admin:
        raise AccessDeniedError("Cannot read another owner's migration conflict")
    return conflict


def list_conflicts_for_user(db: Session, user: User) -> list[MigrationConflict]:
    return list(
        db.scalars(
            select(MigrationConflict)
            .where(MigrationConflict.owner_user_id == user.id)
            .order_by(MigrationConflict.created_at)
        )
    )


def resolve_conflict(
    db: Session,
    conflict: MigrationConflict,
    user: User,
    *,
    action: str,
    fields: dict[str, str],
) -> MigrationConflict:
    resolution = {"action": action, "fields": fields}
    if conflict.status != MigrationConflictStatus.PENDING:
        # A retried resolve of the exact same decision replays cleanly;
        # anything else means the review item was already decided.
        if conflict.resolution == resolution:
            return conflict
        raise ConflictError("Migration conflict was already resolved differently")

    if action != "dismiss":
        unknown = sorted(set(fields) - set(conflict.conflicting_fields))
        if unknown:
            raise InvalidInputError(f"Unknown conflict fields: {unknown}")

    conflict.status = (
        MigrationConflictStatus.DISMISSED
        if action == "dismiss"
        else MigrationConflictStatus.RESOLVED
    )
    conflict.resolution = resolution
    conflict.resolved_by = user.id
    conflict.resolved_at = utcnow_iso()
    try:
        with UnitOfWork(db):
            pass
    except StaleDataError as exc:
        raise ConflictError(
            "Migration conflict changed concurrently; reload and retry"
        ) from exc
    db.refresh(conflict)
    return conflict


def create_conflict(
    db: Session,
    *,
    run_id: str,
    kind: str,
    owner_user_id: str,
    workspace_id: str,
    source_section_id: str | None,
    member_a_id: str,
    member_b_id: str,
    conflicting_fields: list[str],
    conflicting_media: list[dict],
    blocks_finalization: bool = False,
) -> MigrationConflict:
    """Idempotent: replaying the conflict-detection phase for the same
    ``(run, kind, member_a, member_b)`` returns the existing row via
    ``uq_migration_conflict_pair`` instead of raising a duplicate-key error."""

    def _existing() -> MigrationConflict | None:
        return db.scalar(
            select(MigrationConflict).where(
                MigrationConflict.run_id == run_id,
                MigrationConflict.kind == kind,
                MigrationConflict.member_a_id == member_a_id,
                MigrationConflict.member_b_id == member_b_id,
            )
        )

    if (conflict := _existing()) is not None:
        return conflict

    conflict = MigrationConflict(
        run_id=run_id,
        kind=kind,
        owner_user_id=owner_user_id,
        workspace_id=workspace_id,
        source_section_id=source_section_id,
        member_a_id=member_a_id,
        member_b_id=member_b_id,
        conflicting_fields=conflicting_fields,
        conflicting_media=conflicting_media,
        blocks_finalization=blocks_finalization,
    )
    db.add(conflict)
    try:
        with UnitOfWork(db):
            pass
    except IntegrityError:
        if (conflict := _existing()) is None:
            raise
        return conflict
    db.refresh(conflict)
    return conflict
