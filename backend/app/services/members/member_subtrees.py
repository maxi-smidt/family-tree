"""Transactional workflows for creating member-linked subtrees."""

from uuid import uuid4

from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.models import Member, Workspace
from app.models.user import User
from app.services.activity.activity import record_activity
from app.services.event_bus import publish_workspace_event
from app.services.members.member_clone import clone_member, wire_bridge
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.workspace_state import mark_workspace_opened


def create_linked_subtree(
    db: Session, *, source_workspace: Workspace, member: Member, owner: User, name: str
) -> Workspace:
    """Create and seed a tree, then atomically wire its bridge person."""
    with UnitOfWork(db) as uow:
        new_tree = Workspace(
            id=str(uuid4()),
            name=name,
            owner_id=owner.id,
            created_at=utcnow_iso(),
        )
        db.add(new_tree)
        db.flush()
        mark_workspace_opened(db, new_tree.id, owner.id)

        counterpart = clone_member(member, new_tree.id, str(uuid4()))
        counterpart.position_x = 0
        counterpart.position_y = 0
        counterpart.is_collapsed = False
        db.add(counterpart)
        db.flush()
        wire_bridge(member, counterpart)

        label = " ".join(filter(None, [member.first_name, member.last_name])) or None
        record_activity(
            db,
            workspace_id=source_workspace.id,
            actor=owner,
            action="update",
            target_type="member",
            target_id=member.id,
            target_label=label,
            details={"after": {"linked_workspace_id": new_tree.id}},
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                source_workspace,
                "activity.entry_added",
                {"workspace_id": source_workspace.id},
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                source_workspace,
                "workspace.content_changed",
                {"workspace_id": source_workspace.id, "domain": "member"},
            )
        )
    db.refresh(member)
    db.refresh(new_tree)
    return new_tree
