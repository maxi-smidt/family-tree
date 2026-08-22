"""Vital-event mirroring and parent-slot reconciliation for member saves.

Shared by the single-member update workflow (``member_update``) and member
merge (``app.api.routes.members``), since both need to keep the derived
birth/death events and the explicit parent slots consistent after a member's
fields change.
"""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.base import utcnow_iso
from app.models import Event, EventMemberLink, Member, Relation, Tree, TreeMembership
from app.models.user import User
from app.services.system import feature_service


def event_updates_allowed(db: Session, tree: Tree, user: User) -> bool:
    """Whether this editor can update the derived vital-event mirror.

    Member dates are core data, while Events is optional and can be hidden for
    an editor.  A disabled/restricted Events domain must therefore never turn a
    member save into a partial failure.
    """
    if not feature_service.is_enabled(db, "events", user):
        return False
    membership = db.get(TreeMembership, (tree.id, user.id))
    return not (
        membership and membership.restrictions and "events" in membership.restrictions
    )


def sync_vital_event(
    db: Session,
    tree: Tree,
    member: Member,
    event_type: str,
    date: str | None,
    location: str | None,
) -> None:
    """Keep one member's birth/death event aligned without losing documents."""
    events = list(
        db.scalars(
            select(Event)
            .join(EventMemberLink, EventMemberLink.event_id == Event.id)
            .where(
                Event.tree_id == tree.id,
                Event.event_type == event_type,
                EventMemberLink.member_id == member.id,
            )
            .order_by(Event.id)
        ).all()
    )
    existing = events[0] if events else None
    if date:
        if existing is not None:
            # Do not replace the row: its description and linked documents
            # are user-authored details preserved by #659. The location is
            # only backfilled while still empty, so an existing (possibly
            # user-authored) location is never silently overwritten (#769).
            existing.date = date
            if location and not existing.location:
                existing.location = location
            return
        event = Event(
            id=str(uuid4()),
            tree_id=tree.id,
            event_type=event_type,
            date=date,
            location=location,
            created_at=utcnow_iso(),
        )
        db.add(event)
        db.flush()
        db.add(EventMemberLink(event_id=event.id, member_id=member.id))
    elif existing is not None:
        db.delete(existing)


def sync_parent_slots(
    db: Session,
    tree: Tree,
    member: Member,
    paternal_changed: bool,
    paternal_parent_id: str | None,
    maternal_changed: bool,
    maternal_parent_id: str | None,
) -> None:
    """Apply explicit parent-slot changes without touching extra parent rows.

    The persisted relation model has no slot column.  We reconstruct the two
    slots with the same gender-first rule as the frontend, then replace only a
    slot the request explicitly changed.  Replaying the same payload is a
    no-op, which keeps retries idempotent.
    """
    relations = list(
        db.scalars(
            select(Relation).where(
                Relation.tree_id == tree.id,
                Relation.from_member_id == member.id,
                Relation.relation_type == "parent",
            )
        ).all()
    )
    parent_ids = [relation.to_member_id for relation in relations]
    parents = {
        parent.id: parent
        for parent in db.scalars(
            select(Member).where(Member.tree_id == tree.id, Member.id.in_(parent_ids))
        ).all()
    }

    paternal_current: str | None = None
    maternal_current: str | None = None
    for parent_id in parent_ids:
        gender = parents.get(parent_id).gender if parent_id in parents else None
        if gender == "m" and paternal_current is None:
            paternal_current = parent_id
        elif gender == "f" and maternal_current is None:
            maternal_current = parent_id
    for parent_id in parent_ids:
        if parent_id in {paternal_current, maternal_current}:
            continue
        if paternal_current is None:
            paternal_current = parent_id
        elif maternal_current is None:
            maternal_current = parent_id

    for changed, previous, replacement in (
        (paternal_changed, paternal_current, paternal_parent_id),
        (maternal_changed, maternal_current, maternal_parent_id),
    ):
        if not changed:
            continue
        if replacement == previous:
            continue
        if previous is not None:
            relation = db.get(Relation, (tree.id, member.id, previous, "parent"))
            if relation is not None:
                db.delete(relation)
        if replacement is None:
            continue
        parent = parents.get(replacement)
        if parent is None:
            parent = db.scalar(
                select(Member).where(
                    Member.id == replacement,
                    Member.tree_id == tree.id,
                )
            )
        if parent is None:
            raise NotFoundError("parent_id not found in this tree")
        if db.get(Relation, (tree.id, member.id, replacement, "parent")) is None:
            db.add(
                Relation(
                    tree_id=tree.id,
                    from_member_id=member.id,
                    to_member_id=replacement,
                    relation_type="parent",
                )
            )
