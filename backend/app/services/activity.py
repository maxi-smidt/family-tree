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
    Document,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    MemberTaskLink,
    Story,
    StoryDocumentLink,
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


def event_delete_snapshot(db: Session, event: Event) -> dict:
    """Full pre-image of an event row and its member/document links.

    Must be called BEFORE ``db.delete(event)``. Events own no media directly
    (only documents linked through ``event_document_link`` do), so unlike the
    gallery/document snapshots below there is no media to trash.
    """
    member_links = db.scalars(
        select(EventMemberLink).where(EventMemberLink.event_id == event.id)
    ).all()
    document_links = db.scalars(
        select(EventDocumentLink).where(EventDocumentLink.event_id == event.id)
    ).all()
    return delete_snapshot(
        event=row_to_dict(event),
        member_links=[row_to_dict(r) for r in member_links],
        document_links=[row_to_dict(r) for r in document_links],
    )


def story_delete_snapshot(db: Session, story: Story) -> dict:
    """Full pre-image of a story row and its member/document links.

    Must be called BEFORE ``db.delete(story)``. Stories own no media directly,
    mirroring ``event_delete_snapshot``.
    """
    member_links = db.scalars(
        select(StoryMemberLink).where(StoryMemberLink.story_id == story.id)
    ).all()
    document_links = db.scalars(
        select(StoryDocumentLink).where(StoryDocumentLink.story_id == story.id)
    ).all()
    return delete_snapshot(
        story=row_to_dict(story),
        member_links=[row_to_dict(r) for r in member_links],
        document_links=[row_to_dict(r) for r in document_links],
    )


def gallery_delete_snapshot(db: Session, image: GalleryImage) -> dict:
    """Full pre-image of a gallery image row and its member links.

    Must be called BEFORE ``db.delete(image)``. ``member_links`` includes any
    face-tag regions (x/y/w/h). ``gallery_unknown_faces`` rows cascade away
    with the image but are deliberately not snapshotted here, mirroring the
    virtual-view-match exclusion in ``member_delete_snapshot``. ``trashed_media``
    records the media URL the caller is expected to move into per-tree trash
    (``app.services.storage.trash_media``) rather than delete outright.
    """
    member_links = db.scalars(
        select(GalleryMemberLink).where(GalleryMemberLink.gallery_image_id == image.id)
    ).all()
    return delete_snapshot(
        gallery_image=row_to_dict(image),
        member_links=[row_to_dict(r) for r in member_links],
        trashed_media=[image.image_data] if image.image_data else [],
    )


def document_delete_snapshot(db: Session, document: Document) -> dict:
    """Full pre-image of a document row, its files, and every link table.

    Must be called BEFORE ``db.delete(document)``. ``trashed_media`` records
    the file-kind attachment URLs the caller is expected to move into
    per-tree trash rather than delete outright (link-kind attachments have no
    backing file, so they're excluded).
    """
    files = document.files
    member_links = db.scalars(
        select(DocumentMemberLink).where(DocumentMemberLink.document_id == document.id)
    ).all()
    event_links = db.scalars(
        select(EventDocumentLink).where(EventDocumentLink.document_id == document.id)
    ).all()
    story_links = db.scalars(
        select(StoryDocumentLink).where(StoryDocumentLink.document_id == document.id)
    ).all()
    return delete_snapshot(
        document=row_to_dict(document),
        files=[row_to_dict(f) for f in files],
        member_links=[row_to_dict(r) for r in member_links],
        event_links=[row_to_dict(r) for r in event_links],
        story_links=[row_to_dict(r) for r in story_links],
        trashed_media=[f.url for f in files if f.kind == "file"],
    )


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
) -> ActivityLog:
    """Add (not commit) a new activity row and return it.

    The caller commits as part of its own transaction. The return value lets
    callers that need the new row's id (e.g. the undo endpoint, which
    references its own logged entry) avoid a second query — existing callers
    that ignore the return value are unaffected.
    """
    row = ActivityLog(
        tree_id=tree_id,
        actor_id=actor.id,
        actor_username=actor.username,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_label=target_label,
        details=json.dumps(details) if details is not None else None,
    )
    db.add(row)
    return row
