"""Application service for ``PATCH /members/{id}``.

Orchestrates parent-slot reconciliation, the derived vital-event mirror,
tree-link validation, bridge-person sync, activity recording and cache
invalidation, so the route is left doing only HTTP input/output mapping (the
same shape ``document_service.save_document`` gives the document save path).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.exceptions import (
    InvalidInputError,
    PayloadTooLargeError,
    QuotaExceeded,
)
from app.models import Member, Tree
from app.models.user import User
from app.schemas.family import MemberUpdate
from app.services.activity.activity import record_activity
from app.services.bridge import (
    sync_bridge_person,
    validate_linked_member,
    validate_linked_tree,
)
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_tree_event
from app.services.member_access import get_member
from app.services.member_vitals import (
    event_updates_allowed,
    sync_parent_slots,
    sync_vital_event,
)
from app.services.settings_service import get_media_limits
from app.services.storage import (
    MEDIA_URL_PREFIX,
    ImageTooLarge,
    UnsupportedImageType,
    delete_media,
    process_image_field,
)
from app.services.storage_usage import check_media_quota

# Positional/internal fields excluded from the before/after activity diff.
_DIFF_SKIP_FIELDS = {"position_x", "position_y", "is_collapsed", "image_data"}


@dataclass(frozen=True)
class MemberUpdateResult:
    member: Member
    bridge_sync: str | None


def update_member(
    db: Session, *, tree: Tree, user: User, member_id: str, payload: MemberUpdate
) -> MemberUpdateResult:
    """Apply *payload* to one member and every downstream effect as one unit.

    Raises ``InvalidInputError``, ``NotFoundError``, ``QuotaExceeded`` or
    ``PayloadTooLargeError`` on invalid input, an unresolvable link, or an
    over-quota image — always before the member row itself is committed.
    """
    member = get_member(db, tree, member_id)
    changes = payload.model_dump(exclude_unset=True)
    paternal_changed = "paternal_parent_id" in changes
    maternal_changed = "maternal_parent_id" in changes
    paternal_parent_id = changes.pop("paternal_parent_id", None)
    maternal_parent_id = changes.pop("maternal_parent_id", None)
    # The member form re-sends the link fields unchanged on every save. Only an
    # actual change is a link edit — an unchanged value must not re-run the
    # feature/access checks, otherwise ordinary edits fail once the tree_links
    # flag is turned off (or for editors without access to the linked tree).
    if "linked_tree_id" in changes and changes["linked_tree_id"] == member.linked_tree_id:
        del changes["linked_tree_id"]
    if (
        "linked_member_id" in changes
        and changes["linked_member_id"] == member.linked_member_id
    ):
        del changes["linked_member_id"]
    unlinked_counterpart_tree: Tree | None = None
    if "linked_tree_id" in changes:
        if changes["linked_tree_id"] is not None:
            # Establishing a link requires resolving a bridge person on both
            # sides, which touches two trees — this single-row endpoint can't
            # do that safely. Only clearing (null) or leaving it unchanged is
            # allowed here; see POST /members/{id}/link.
            raise InvalidInputError("Establish tree links via the link endpoint")
        validate_linked_tree(db, tree, user, changes["linked_tree_id"])
        # Unlinking invalidates the counterpart pointer into the old tree.
        changes["linked_member_id"] = None
        # Tear down the other side too: a bridge is symmetric, so unlinking
        # here must also clear the counterpart's fields. Otherwise the link
        # lingers in the other tree (phantom badge) and identity edits keep
        # flowing one-directionally from the still-linked counterpart back to
        # this member. Cleared unconditionally, like the delete path — this is
        # integrity cleanup of a now-broken bridge, not a content edit.
        if member.linked_member_id is not None:
            counterpart = db.get(Member, member.linked_member_id)
            if counterpart is not None:
                counterpart.linked_tree_id = None
                counterpart.linked_member_id = None
                unlinked_counterpart_tree = db.get(Tree, counterpart.tree_id)
    if changes.get("linked_member_id") is not None:
        validate_linked_member(
            db,
            changes.get("linked_tree_id", member.linked_tree_id),
            changes["linked_member_id"],
            member.id,
        )
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
    # Bridge person: mirror identity edits onto the counterpart row so the
    # same human stays consistent on both sides of a tree-in-tree link.
    bridge_sync, synced_tree = sync_bridge_person(db, member, changes, user)
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
        tree_id=tree.id,
        actor=user,
        action="update",
        target_type="member",
        target_id=member.id,
        target_label=label,
        details=diff_details,
    )
    db.commit()
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(member)
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "member"},
    )
    if vital_events_changed:
        publish_tree_event(
            db,
            tree,
            "tree.content_changed",
            {"tree_id": tree.id, "domain": "event"},
        )
    invalidate_stats(tree.id)
    if synced_tree is not None:
        publish_tree_event(
            db,
            synced_tree,
            "tree.content_changed",
            {"tree_id": synced_tree.id, "domain": "member"},
        )
        invalidate_stats(synced_tree.id)
    if unlinked_counterpart_tree is not None:
        publish_tree_event(
            db,
            unlinked_counterpart_tree,
            "tree.content_changed",
            {"tree_id": unlinked_counterpart_tree.id, "domain": "member"},
        )
        invalidate_stats(unlinked_counterpart_tree.id)
    return MemberUpdateResult(member=member, bridge_sync=bridge_sync)
