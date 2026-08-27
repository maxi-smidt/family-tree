"""Application service for ``PATCH /members/{id}``.

Orchestrates parent-slot reconciliation, the derived vital-event mirror,
activity recording and cache invalidation, so the route is left doing only
HTTP input/output mapping (the same shape ``document_service.save_document``
gives the document save path).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.exceptions import (
    InvalidInputError,
    PayloadTooLargeError,
    QuotaExceeded,
)
from app.models import Member, Workspace
from app.models.user import User
from app.schemas.family import MemberUpdate
from app.services.activity.activity import record_activity
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_workspace_event
from app.services.media.storage import (
    MEDIA_URL_PREFIX,
    ImageTooLarge,
    UnsupportedImageType,
    delete_media,
    process_image_field,
)
from app.services.media.storage_usage import check_media_quota
from app.services.members.member_access import get_member
from app.services.members.member_vitals import (
    event_updates_allowed,
    sync_parent_slots,
    sync_vital_event,
)
from app.services.system.settings_service import get_media_limits
from app.services.unit_of_work import UnitOfWork

# Positional/internal fields excluded from the before/after activity diff.
_DIFF_SKIP_FIELDS = {"position_x", "position_y", "is_collapsed", "image_data"}


@dataclass(frozen=True)
class MemberUpdateResult:
    member: Member


def update_member(
    db: Session, *, tree: Workspace, user: User, member_id: str, payload: MemberUpdate
) -> MemberUpdateResult:
    """Apply *payload* to one member and every downstream effect as one unit.

    Raises ``NotFoundError``, ``QuotaExceeded`` or ``PayloadTooLargeError`` on
    invalid input or an over-quota image — always before the member row
    itself is committed.
    """
    member = get_member(db, tree, member_id)
    changes = payload.model_dump(exclude_unset=True)
    paternal_changed = "paternal_parent_id" in changes
    maternal_changed = "maternal_parent_id" in changes
    paternal_parent_id = changes.pop("paternal_parent_id", None)
    maternal_parent_id = changes.pop("maternal_parent_id", None)
    new_image_url: str | None = None
    if "image_data" in changes:
        try:
            new_url = process_image_field(
                tree.id,
                changes["image_data"],
                get_media_limits(db),
            )
        except ImageTooLarge as exc:
            raise PayloadTooLargeError(str(exc)) from exc
        except (UnsupportedImageType, ValueError) as exc:
            raise InvalidInputError(str(exc)) from exc
        changes["image_data"] = new_url
        if new_url and new_url.startswith(MEDIA_URL_PREFIX):
            new_image_url = new_url

    # Check media quota for the new image (write-then-verify: file already on
    # disk and counted by compute_usage, so pass 0 to avoid double-counting).
    if new_image_url:
        try:
            check_media_quota(db, tree, 0)
        except QuotaExceeded:
            delete_media(new_image_url)
            raise
    with UnitOfWork(db) as uow:
        # Capture before-state for diff details (skip noisy positional/internal fields).
        before = {k: getattr(member, k) for k in changes if k not in _DIFF_SKIP_FIELDS}
        for key, value in changes.items():
            setattr(member, key, value)
        if paternal_changed or maternal_changed:
            sync_parent_slots(
                db,
                tree,
                member,
                paternal_changed,
                paternal_parent_id,
                maternal_changed,
                maternal_parent_id,
            )
        vital_events_changed = event_updates_allowed(db, tree, user) and (
            "date_of_birth" in changes
            or "date_of_death" in changes
            or "birthplace" in changes
            or "cemetery" in changes
        )
        if vital_events_changed:
            # member fields above are already mutated by the setattr loop, so the
            # current date/place reflect this save even when only one of the pair
            # (e.g. birthplace without a date change) was actually sent.
            if "date_of_birth" in changes or "birthplace" in changes:
                sync_vital_event(
                    db, tree, member, "birth", member.date_of_birth, member.birthplace
                )
            if "date_of_death" in changes or "cemetery" in changes:
                sync_vital_event(
                    db, tree, member, "death", member.date_of_death, member.cemetery
                )
        after = {k: getattr(member, k) for k in before}
        diff_details: dict | None = None
        changed = {
            k: {"before": before[k], "after": after[k]}
            for k in before
            if before[k] != after[k]
        }
        if changed:
            diff_details = {
                "before": {k: v["before"] for k, v in changed.items()},
                "after": {k: v["after"] for k, v in changed.items()},
            }
        label = " ".join(filter(None, [member.first_name, member.last_name])) or None
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="member",
            target_id=member.id,
            target_label=label,
            details=diff_details,
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "member"},
            )
        )
        if vital_events_changed:
            uow.after_commit(
                lambda: publish_workspace_event(
                    db,
                    tree,
                    "workspace.content_changed",
                    {"workspace_id": tree.id, "domain": "event"},
                )
            )
        uow.after_commit(lambda: invalidate_stats(tree.id))
    db.refresh(member)
    return MemberUpdateResult(member=member)
