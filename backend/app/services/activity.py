"""Lightweight helper for recording activity-log entries.

Usage inside a mutation route (before the existing db.commit()):

    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="create",
        target_type="member",
        target_id=member.id,
        target_label="Ada Doe",
    )
    db.commit()

The helper only calls ``db.add(...)``; it does NOT commit so the new row
participates in the route's own transaction and is rolled back on error.
"""

import json

from sqlalchemy import inspect, or_, select
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models.activity import ActivityLog
from app.models.content import (
    DocumentMemberLink,
    EventMemberLink,
    GalleryMemberLink,
    MemberTaskLink,
    StoryMemberLink,
)
from app.models.family import Member, MemberDisease, Relation
from app.models.user import User

# Version of the delete-snapshot payload shape stored in ``details``
# (see docs/ACTIVITY_AUDIT.md §b). Bump when the shape changes so a future
# undo feature can dispatch on it.
SNAPSHOT_VERSION = 1


def row_to_dict(obj: Base) -> dict:
    """Serialize a mapped row's column values into a JSON-safe dict.

    Uses mapper inspection so columns added by future migrations are picked up
    automatically. All column types in the snapshotted tables are str / float /
    bool / None, which ``json.dumps`` handles directly.
    """
    return {attr.key: getattr(obj, attr.key) for attr in inspect(obj).mapper.column_attrs}


def delete_snapshot(**tables: object) -> dict:
    """Wrap per-table pre-image data into the versioned delete payload."""
    return {"snapshot": {"version": SNAPSHOT_VERSION, **tables}}


def member_delete_snapshot(
    db: Session, member: Member, counterpart: Member | None = None
) -> dict:
    """Full pre-image of a member row and its cascade children.

    Must be called BEFORE ``db.delete(member)``. Captures everything the DB
    cascade will remove: relations on either side, disease records, and the
    five content link tables (research-task rows themselves survive a member
    delete; only their links cascade). ``counterpart`` is the bridge person in the
    linked tree whose link pointers the delete route dissolves; its identity
    is recorded so the tree-in-tree link can be re-established on undo.
    Virtual-view match rows also cascade but are derived state the matching
    service recomputes, so they are deliberately not snapshotted.
    """
    relations = db.scalars(
        select(Relation).where(
            or_(
                Relation.from_member_id == member.id,
                Relation.to_member_id == member.id,
            )
        )
    ).all()
    diseases = db.scalars(
        select(MemberDisease).where(MemberDisease.member_id == member.id)
    ).all()
    tables: dict[str, object] = {
        "member": row_to_dict(member),
        "relations": [row_to_dict(r) for r in relations],
        "diseases": [row_to_dict(d) for d in diseases],
    }
    for key, model in (
        ("task_links", MemberTaskLink),
        ("event_links", EventMemberLink),
        ("story_links", StoryMemberLink),
        ("gallery_links", GalleryMemberLink),
        ("document_links", DocumentMemberLink),
    ):
        rows = db.scalars(select(model).where(model.member_id == member.id)).all()
        tables[key] = [row_to_dict(r) for r in rows]
    if counterpart is not None:
        tables["bridge"] = {
            "counterpart_member_id": counterpart.id,
            "counterpart_tree_id": counterpart.tree_id,
        }
    return delete_snapshot(**tables)


def record_activity(
    db: Session,
    *,
    tree_id: str,
    actor: User,
    action: str,
    target_type: str,
    target_id: str | None = None,
    target_label: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        ActivityLog(
            tree_id=tree_id,
            actor_id=actor.id,
            actor_username=actor.username,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_label=target_label,
            details=json.dumps(details) if details is not None else None,
        )
    )
