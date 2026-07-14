"""Transactional workflows for creating member-linked subtrees."""

from uuid import uuid4

from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.models import Member, Tree
from app.models.user import User
from app.services.activity import record_activity
from app.services.event_bus import publish_tree_event
from app.services.merge import _clone_member, _wire_bridge


def create_linked_subtree(
    db: Session, *, source_tree: Tree, member: Member, owner: User, name: str
) -> Tree:
    """Create and seed a tree, then atomically wire its bridge person."""
    new_tree = Tree(
        id=str(uuid4()),
        name=name,
        owner_id=owner.id,
        created_at=utcnow_iso(),
        last_opened=utcnow_iso(),
    )
    db.add(new_tree)
    db.flush()

    counterpart = _clone_member(member, new_tree.id, str(uuid4()))
    counterpart.position_x = 0
    counterpart.position_y = 0
    counterpart.is_collapsed = False
    db.add(counterpart)
    db.flush()
    _wire_bridge(member, counterpart)

    label = " ".join(filter(None, [member.first_name, member.last_name])) or None
    record_activity(
        db,
        tree_id=source_tree.id,
        actor=owner,
        action="update",
        target_type="member",
        target_id=member.id,
        target_label=label,
        details={"after": {"linked_tree_id": new_tree.id}},
    )
    db.commit()
    db.refresh(member)
    db.refresh(new_tree)
    publish_tree_event(
        db,
        source_tree,
        "activity.entry_added",
        {"tree_id": source_tree.id},
    )
    publish_tree_event(
        db,
        source_tree,
        "tree.content_changed",
        {"tree_id": source_tree.id, "domain": "member"},
    )
    return new_tree
