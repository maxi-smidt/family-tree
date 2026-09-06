"""Pending migration review conflicts (#997): bridge-merge conflicts and
virtual-view match suggestions surfaced for owner review.

Resolving records the decision using the same field-choice shape as the
existing merge assistant (``app.schemas.merge.MergeResolution``). For a
``bridge_merge`` conflict, a ``"merge"`` action also applies the chosen
field/photo values to the surviving ``Member`` row (#1018) — the other row
was already deleted by the bridge collapse that created this conflict, so
``conflict.field_values``/``conflicting_media`` (captured at that point) are
the only remaining source for its alternative values. ``"dismiss"`` and
``"keep_both"`` only record the decision: the canonical row already holds its
own values, so there is nothing to apply.
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
from app.models import Member, Workspace
from app.models.migration import (
    MigrationConflict,
    MigrationConflictKind,
    MigrationConflictStatus,
)
from app.models.user import User
from app.schemas.notification import MigrationConflictPendingPayload
from app.services.activity.activity import record_activity
from app.services.cache import invalidate_stats
from app.services.collaboration.notification_service import create_notification
from app.services.event_bus import publish_workspace_event
from app.services.unit_of_work import UnitOfWork

# additional_data/places_lived are free text, so a "combine" choice can join
# both values instead of picking one — mirrors the same rule in
# app.services.members.member_clone.apply_field_choices.
_COMBINABLE_FIELDS = {"additional_data", "places_lived"}


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


def _combine_text(value_a: str | None, value_b: str | None, field: str) -> str | None:
    separator = "\n\n" if field == "additional_data" else ", "
    seen: list[str] = []
    for value in (value_a, value_b):
        if (value or "").strip() and value not in seen:
            seen.append(value)
    return separator.join(seen) if seen else None


def _apply_bridge_resolution(
    db: Session, conflict: MigrationConflict, fields: dict[str, str]
) -> Member | None:
    """Apply a "merge" resolution's per-field/photo choices onto the
    surviving ``Member`` row.

    Raises ``ConflictError`` when the canonical member's current value for a
    chosen field no longer matches the value captured when this conflict was
    created — an edit made after migration must be re-reviewed rather than
    silently overwritten.
    """
    if not fields or conflict.canonical_member_id is None:
        return None
    # Row-locked so a concurrent normal edit of this member can't commit
    # between the stale-value check below and this transaction's own commit
    # and be silently overwritten — Member has no optimistic version column
    # of its own to catch that otherwise.
    member = db.get(Member, conflict.canonical_member_id, with_for_update=True)
    if member is None:
        raise NotFoundError("Canonical member no longer exists")

    for field, choice in fields.items():
        if field == "image_data":
            media = next(
                (m for m in conflict.conflicting_media if "canonical_image_data" in m),
                None,
            )
            if media is None:
                continue
            if (member.image_data or None) != (media["canonical_image_data"] or None):
                raise ConflictError(
                    "Canonical member changed after migration; reload and retry"
                )
            # "a"/"b" mean member_a_id's/member_b_id's value, same as the
            # scalar-field branch below — canonical_member_id is only ever
            # one of those two, and not always member_a_id, so it can't be
            # assumed to mean "a".
            photo_values = {
                media["canonical_member_id"]: media["canonical_image_data"],
                media["member_id"]: media["image_data"],
            }
            if choice == "a":
                member.image_data = photo_values.get(conflict.member_a_id)
            elif choice == "b":
                member.image_data = photo_values.get(conflict.member_b_id)
            else:
                raise InvalidInputError(f"Unsupported choice for image_data: {choice!r}")
            continue

        values = conflict.field_values.get(field)
        if values is None:
            continue
        canonical_value = values.get(conflict.canonical_member_id)
        if (getattr(member, field) or None) != (canonical_value or None):
            raise ConflictError(
                "Canonical member changed after migration; reload and retry"
            )
        value_a = values.get(conflict.member_a_id)
        value_b = values.get(conflict.member_b_id)
        if choice == "a":
            setattr(member, field, value_a)
        elif choice == "b":
            setattr(member, field, value_b)
        elif choice == "combine":
            if field not in _COMBINABLE_FIELDS:
                raise InvalidInputError(f"{field!r} cannot be combined")
            setattr(member, field, _combine_text(value_a, value_b, field))
        else:
            raise InvalidInputError(f"Unsupported choice for {field!r}: {choice!r}")
    return member


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

    allowed_fields = set(conflict.conflicting_fields)
    if conflict.conflicting_media:
        allowed_fields.add("image_data")
    if action != "dismiss":
        unknown = sorted(set(fields) - allowed_fields)
        if unknown:
            raise InvalidInputError(f"Unknown conflict fields: {unknown}")

    member = None
    if action == "merge" and conflict.kind == MigrationConflictKind.BRIDGE_MERGE:
        member = _apply_bridge_resolution(db, conflict, fields)

    conflict.status = (
        MigrationConflictStatus.DISMISSED
        if action == "dismiss"
        else MigrationConflictStatus.RESOLVED
    )
    conflict.resolution = resolution
    conflict.resolved_by = user.id
    conflict.resolved_at = utcnow_iso()

    try:
        # Looked up inside the guarded block: it runs after conflict/member
        # were already mutated above, so any flush it provokes must have its
        # StaleDataError converted to a 409 below rather than escape raw.
        workspace = (
            db.get(Workspace, conflict.workspace_id) if member is not None else None
        )
        with UnitOfWork(db) as uow:
            if member is not None:
                label = " ".join(
                    filter(None, [member.first_name, member.last_name])
                ) or None
                record_activity(
                    db,
                    workspace_id=conflict.workspace_id,
                    actor=user,
                    action="update",
                    target_type="member",
                    target_id=member.id,
                    target_label=label,
                    details={
                        "migration_conflict_id": conflict.id,
                        "resolution": resolution,
                    },
                )
                if workspace is not None:
                    uow.after_commit(
                        lambda: publish_workspace_event(
                            db,
                            workspace,
                            "workspace.content_changed",
                            {"workspace_id": workspace.id, "domain": "member"},
                        )
                    )
                    uow.after_commit(lambda: invalidate_stats(workspace.id))
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
    canonical_member_id: str | None = None,
    field_values: dict | None = None,
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
        canonical_member_id=canonical_member_id,
        conflicting_fields=conflicting_fields,
        field_values=field_values or {},
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
    create_notification(
        db,
        owner_user_id,
        "migration_conflict_pending",
        MigrationConflictPendingPayload(
            run_id=run_id, conflict_id=conflict.id, workspace_id=workspace_id
        ),
    )
    return conflict
