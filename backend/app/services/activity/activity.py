"""Lightweight helper for recording activity-log entries.

Usage inside a mutation route (before the existing db.commit()):

    record_activity(
        db,
        workspace_id=tree.id,
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
    DocumentFile,
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
from app.models.provenance import ContentType
from app.models.user import User
from app.services.activity.activity_snapshots import (
    BridgeSnapshot,
    DeleteSnapshot,
    DiseaseSnapshot,
    DocumentFileSnapshot,
    DocumentSnapshot,
    EventSnapshot,
    GalleryImageSnapshot,
    MemberSnapshot,
    RelationSnapshot,
    StorySnapshot,
)
from app.services.provenance import scope_snapshot

# Version of the delete-snapshot payload shape stored in ``details``
# (see docs/ACTIVITY_AUDIT.md §b). Bump when the shape changes so a future
# undo operation can dispatch on it.
SNAPSHOT_VERSION = 1


def row_to_dict(obj: Base) -> dict:
    """Serialize a mapped row's column values into a JSON-safe dict.

    Uses mapper inspection so columns added by future migrations are picked up
    automatically. All column types in the snapshotted tables are str / float /
    bool / None, which ``json.dumps`` handles directly.
    """
    return {attr.key: getattr(obj, attr.key) for attr in inspect(obj).mapper.column_attrs}


def member_delete_snapshot(
    db: Session, member: Member, counterpart: Member | None = None
) -> DeleteSnapshot[MemberSnapshot]:
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
    task_links = db.scalars(
        select(MemberTaskLink).where(MemberTaskLink.member_id == member.id)
    ).all()
    event_links = db.scalars(
        select(EventMemberLink).where(EventMemberLink.member_id == member.id)
    ).all()
    story_links = db.scalars(
        select(StoryMemberLink).where(StoryMemberLink.member_id == member.id)
    ).all()
    gallery_links = db.scalars(
        select(GalleryMemberLink).where(GalleryMemberLink.member_id == member.id)
    ).all()
    document_links = db.scalars(
        select(DocumentMemberLink).where(DocumentMemberLink.member_id == member.id)
    ).all()

    snapshot: MemberSnapshot = {
        "version": SNAPSHOT_VERSION,
        "member": row_to_dict(member),
        "relations": [row_to_dict(r) for r in relations],
        "diseases": [row_to_dict(d) for d in diseases],
        "content_scopes": scope_snapshot(
            db, [(ContentType.DISEASE, d.id) for d in diseases]
        ),
        "task_links": [row_to_dict(r) for r in task_links],
        "event_links": [row_to_dict(r) for r in event_links],
        "story_links": [row_to_dict(r) for r in story_links],
        "gallery_links": [row_to_dict(r) for r in gallery_links],
        "document_links": [row_to_dict(r) for r in document_links],
    }
    if counterpart is not None:
        bridge: BridgeSnapshot = {
            "counterpart_member_id": counterpart.id,
            "counterpart_workspace_id": counterpart.workspace_id,
        }
        snapshot["bridge"] = bridge
    return {"snapshot": snapshot}


def event_delete_snapshot(db: Session, event: Event) -> DeleteSnapshot[EventSnapshot]:
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
    snapshot: EventSnapshot = {
        "version": SNAPSHOT_VERSION,
        "event": row_to_dict(event),
        "content_scopes": scope_snapshot(db, [(ContentType.EVENT, event.id)]),
        "member_links": [row_to_dict(r) for r in member_links],
        "document_links": [row_to_dict(r) for r in document_links],
    }
    return {"snapshot": snapshot}


def story_delete_snapshot(db: Session, story: Story) -> DeleteSnapshot[StorySnapshot]:
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
    snapshot: StorySnapshot = {
        "version": SNAPSHOT_VERSION,
        "story": row_to_dict(story),
        "content_scopes": scope_snapshot(db, [(ContentType.STORY, story.id)]),
        "member_links": [row_to_dict(r) for r in member_links],
        "document_links": [row_to_dict(r) for r in document_links],
    }
    return {"snapshot": snapshot}


def gallery_delete_snapshot(
    db: Session, image: GalleryImage
) -> DeleteSnapshot[GalleryImageSnapshot]:
    """Full pre-image of a gallery image row and its member links.

    Must be called BEFORE ``db.delete(image)``. ``member_links`` includes any
    face-tag regions (x/y/w/h). ``gallery_unknown_faces`` rows cascade away
    with the image but are deliberately not snapshotted here, mirroring the
    virtual-view-match exclusion in ``member_delete_snapshot``. ``trashed_media``
    records the media URL the caller is expected to move into per-tree trash
    (``app.services.media.storage.trash_media``) rather than delete outright.
    """
    member_links = db.scalars(
        select(GalleryMemberLink).where(GalleryMemberLink.gallery_image_id == image.id)
    ).all()
    snapshot: GalleryImageSnapshot = {
        "version": SNAPSHOT_VERSION,
        "gallery_image": row_to_dict(image),
        "content_scopes": scope_snapshot(
            db, [(ContentType.GALLERY_IMAGE, image.id)]
        ),
        "member_links": [row_to_dict(r) for r in member_links],
        "trashed_media": [image.image_data] if image.image_data else [],
    }
    return {"snapshot": snapshot}


def document_delete_snapshot(
    db: Session, document: Document
) -> DeleteSnapshot[DocumentSnapshot]:
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
    snapshot: DocumentSnapshot = {
        "version": SNAPSHOT_VERSION,
        "document": row_to_dict(document),
        "content_scopes": scope_snapshot(db, [(ContentType.DOCUMENT, document.id)]),
        "files": [row_to_dict(f) for f in files],
        "member_links": [row_to_dict(r) for r in member_links],
        "event_links": [row_to_dict(r) for r in event_links],
        "story_links": [row_to_dict(r) for r in story_links],
        "trashed_media": [f.url for f in files if f.kind == "file"],
    }
    return {"snapshot": snapshot}


def relation_delete_snapshot(relation: Relation) -> DeleteSnapshot[RelationSnapshot]:
    """Pre-image of a bare relation delete (no cascade children)."""
    snapshot: RelationSnapshot = {
        "version": SNAPSHOT_VERSION,
        "relation": row_to_dict(relation),
    }
    return {"snapshot": snapshot}


def disease_delete_snapshot(
    db: Session, disease: MemberDisease
) -> DeleteSnapshot[DiseaseSnapshot]:
    """Pre-image of a bare disease-record delete (no cascade children)."""
    snapshot: DiseaseSnapshot = {
        "version": SNAPSHOT_VERSION,
        "disease": row_to_dict(disease),
        "content_scopes": scope_snapshot(db, [(ContentType.DISEASE, disease.id)]),
    }
    return {"snapshot": snapshot}


def document_file_delete_snapshot(
    file: DocumentFile, trashed_url: str | None = None
) -> DeleteSnapshot[DocumentFileSnapshot]:
    """Pre-image of a standalone document-file delete.

    ``trashed_url`` is the file's media URL when it was moved to trash
    (``kind == "file"``); link-kind attachments have no backing file.
    """
    snapshot: DocumentFileSnapshot = {
        "version": SNAPSHOT_VERSION,
        "document_file": row_to_dict(file),
        "trashed_media": [trashed_url] if trashed_url else [],
    }
    return {"snapshot": snapshot}


def record_activity(
    db: Session,
    *,
    workspace_id: str,
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
        workspace_id=workspace_id,
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
