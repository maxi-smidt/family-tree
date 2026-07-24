"""Restore rows from an activity-log delete snapshot (issue #762).

Companion to ``app.services.activity``: that module *records* delete
snapshots, this one *consumes* them. Each ``restore_*`` function mirrors the
matching ``*_delete_snapshot`` builder key-for-key, re-inserting the main row
plus every child that still validates against the tree's current state, and
reporting anything it had to skip instead of failing the whole operation.

Every function here only calls ``db.add(...)`` / mutates attributes — it
never commits. The caller (the undo route) owns the transaction so a
mid-restore failure rolls back cleanly.
"""

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.content import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    MemberTask,
    MemberTaskLink,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
)
from app.models.family import Member, MemberDisease, Relation
from app.models.tree import Tree
from app.schemas.activity import UndoSkippedItem
from app.services.activity_snapshots import (
    DiseaseSnapshot,
    DocumentFileSnapshot,
    DocumentSnapshot,
    EventSnapshot,
    GalleryImageSnapshot,
    MemberSnapshot,
    RelationSnapshot,
    RowSnapshot,
    StorySnapshot,
)


class UndoConflict(Exception):
    """The main row of a restore can't proceed given the current DB state.

    Raised for a double-undo (the row already exists) or a hard dependency
    that is gone (e.g. a relation whose endpoint member was since deleted).
    The route maps this to a 409 response.
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class RestoreResult:
    """What a ``restore_*`` call actually did, for the undo response/log."""

    main_id: str | None
    restored: dict[str, str | int] = field(default_factory=dict)
    skipped: list[UndoSkippedItem] = field(default_factory=list)
    media_to_untrash: list[str] = field(default_factory=list)

    def add_skip(self, table: str, reason: str, row_id: str | None = None) -> None:
        self.skipped.append(UndoSkippedItem(table=table, reason=reason, id=row_id))


def _instantiate(
    model: type, data: dict, *, drop: frozenset[str] = frozenset()
) -> object:
    """Build a model instance from a snapshot row dict.

    Filters to the model's mapped columns (mirrors the introspection
    ``row_to_dict`` uses to build the dict in the first place) minus any
    caller-excluded keys, so derived/computed columns can be left for the ORM
    to (re)populate instead of being set verbatim.
    """
    from sqlalchemy import inspect as sa_inspect

    columns = {attr.key for attr in sa_inspect(model).mapper.column_attrs}
    return model(**{k: v for k, v in data.items() if k in columns and k not in drop})


def _in_tree(db: Session, model: type, row_id: str, tree_id: str) -> object | None:
    """Look up a row by id, but only if it belongs to ``tree_id``.

    Member/event/story/gallery-image/document ids are client-suppliable
    (see e.g. ``MemberCreate.id``), so a plain ``db.get(model, row_id)``
    existence check could be fooled by an unrelated row in a different tree
    that happens to reuse the same id. Every cross-reference validity check
    in this module scopes through here instead, matching the "every content
    query is scoped by tree_id" rule the rest of the app follows. The one
    exception is a *main row* conflict check (a global PK collision, which
    would fail on insert regardless of tree) and the bridge counterpart,
    which is expected to live in a different tree by design.
    """
    row = db.get(model, row_id)
    if row is not None and row.tree_id != tree_id:
        return None
    return row


# ---------------------------------------------------------------------------
# Member (+ relations, diseases, five link tables, bridge)
# ---------------------------------------------------------------------------


def restore_member(db: Session, tree: Tree, snapshot: MemberSnapshot) -> RestoreResult:
    member_data = snapshot["member"]
    member_id = member_data["id"]
    if db.get(Member, member_id) is not None:
        raise UndoConflict(f"member {member_id} already exists")

    member = _instantiate(
        Member, member_data, drop=frozenset({"date_of_birth_sort", "date_of_death_sort"})
    )
    # Bridge pointers are re-established below (only if the counterpart still
    # validates) — never carry a stale pointer straight through on insert.
    member.linked_tree_id = None
    member.linked_member_id = None
    db.add(member)
    db.flush()

    result = RestoreResult(main_id=member_id, restored={"member": member_id})

    bridge = snapshot.get("bridge")
    if bridge is not None:
        # The counterpart is expected to live in a *different* tree by
        # design (that's the whole point of a tree-in-tree bridge), so it's
        # scoped to the bridge's own recorded tree, not the tree being
        # restored into.
        counterpart = _in_tree(
            db, Member, bridge["counterpart_member_id"], bridge["counterpart_tree_id"]
        )
        if counterpart is None:
            result.add_skip(
                "members",
                f"bridge counterpart {bridge['counterpart_member_id']} no longer exists",
            )
        elif counterpart.linked_member_id is not None:
            result.add_skip(
                "members", "bridge counterpart is already linked to another member"
            )
        else:
            member.linked_tree_id = bridge["counterpart_tree_id"]
            member.linked_member_id = counterpart.id
            counterpart.linked_tree_id = tree.id
            counterpart.linked_member_id = member_id
            result.restored["bridge"] = counterpart.id

    relation_count = 0
    for rel in snapshot.get("relations", []):
        other_id = (
            rel["to_member_id"]
            if rel["from_member_id"] == member_id
            else rel["from_member_id"]
        )
        if _in_tree(db, Member, other_id, tree.id) is None:
            result.add_skip("relations", f"member {other_id} no longer exists")
            continue
        key = (tree.id, rel["from_member_id"], rel["to_member_id"], rel["relation_type"])
        if db.get(Relation, key) is not None:
            result.add_skip("relations", "relation already exists")
            continue
        db.add(Relation(**rel))
        relation_count += 1
    if relation_count:
        result.restored["relations"] = relation_count

    disease_count = 0
    for disease in snapshot.get("diseases", []):
        if db.get(MemberDisease, disease["id"]) is not None:
            result.add_skip("diseases", "disease already exists", disease["id"])
            continue
        db.add(MemberDisease(**disease))
        disease_count += 1
    if disease_count:
        result.restored["diseases"] = disease_count

    _restore_member_links(
        db,
        tree,
        result,
        snapshot.get("task_links", []),
        link_model=MemberTaskLink,
        parent_model=MemberTask,
        parent_key="task_id",
        table="task_links",
        parent_label="task",
    )
    _restore_member_links(
        db,
        tree,
        result,
        snapshot.get("event_links", []),
        link_model=EventMemberLink,
        parent_model=Event,
        parent_key="event_id",
        table="event_links",
        parent_label="event",
    )
    _restore_member_links(
        db,
        tree,
        result,
        snapshot.get("story_links", []),
        link_model=StoryMemberLink,
        parent_model=Story,
        parent_key="story_id",
        table="story_links",
        parent_label="story",
    )
    _restore_member_links(
        db,
        tree,
        result,
        snapshot.get("gallery_links", []),
        link_model=GalleryMemberLink,
        parent_model=GalleryImage,
        parent_key="gallery_image_id",
        table="gallery_links",
        parent_label="gallery image",
    )
    _restore_member_links(
        db,
        tree,
        result,
        snapshot.get("document_links", []),
        link_model=DocumentMemberLink,
        parent_model=Document,
        parent_key="document_id",
        table="document_links",
        parent_label="document",
    )
    return result


def _restore_member_links(
    db: Session,
    tree: Tree,
    result: RestoreResult,
    links: list[RowSnapshot],
    *,
    link_model: type,
    parent_model: type,
    parent_key: str,
    table: str,
    parent_label: str,
) -> None:
    count = 0
    for link in links:
        parent_id = link[parent_key]
        if _in_tree(db, parent_model, parent_id, tree.id) is None:
            result.add_skip(table, f"{parent_label} {parent_id} no longer exists")
            continue
        key = (parent_id, link["member_id"])
        if db.get(link_model, key) is not None:
            result.add_skip(table, "link already exists")
            continue
        db.add(link_model(**link))
        count += 1
    if count:
        result.restored[table] = count


# ---------------------------------------------------------------------------
# Bare relation / disease deletes
# ---------------------------------------------------------------------------


def restore_relation(
    db: Session, tree: Tree, snapshot: RelationSnapshot
) -> RestoreResult:
    rel = snapshot["relation"]
    key = (tree.id, rel["from_member_id"], rel["to_member_id"], rel["relation_type"])
    if db.get(Relation, key) is not None:
        raise UndoConflict("relation already exists")
    for member_id in (rel["from_member_id"], rel["to_member_id"]):
        if _in_tree(db, Member, member_id, tree.id) is None:
            raise UndoConflict(f"member {member_id} no longer exists")
    db.add(Relation(**rel))
    return RestoreResult(main_id=None, restored={"relation": 1})


def restore_disease(db: Session, tree: Tree, snapshot: DiseaseSnapshot) -> RestoreResult:
    disease = snapshot["disease"]
    if db.get(MemberDisease, disease["id"]) is not None:
        raise UndoConflict(f"disease {disease['id']} already exists")
    if _in_tree(db, Member, disease["member_id"], tree.id) is None:
        raise UndoConflict(f"member {disease['member_id']} no longer exists")
    db.add(MemberDisease(**disease))
    return RestoreResult(main_id=disease["id"], restored={"disease": disease["id"]})


# ---------------------------------------------------------------------------
# Event / story (main row + member/document links)
# ---------------------------------------------------------------------------


def restore_event(db: Session, tree: Tree, snapshot: EventSnapshot) -> RestoreResult:
    event_data = snapshot["event"]
    event_id = event_data["id"]
    if db.get(Event, event_id) is not None:
        raise UndoConflict(f"event {event_id} already exists")
    db.add(Event(**event_data))
    result = RestoreResult(main_id=event_id, restored={"event": event_id})

    count = 0
    for link in snapshot.get("member_links", []):
        if _in_tree(db, Member, link["member_id"], tree.id) is None:
            result.add_skip(
                "member_links", f"member {link['member_id']} no longer exists"
            )
            continue
        if db.get(EventMemberLink, (event_id, link["member_id"])) is not None:
            result.add_skip("member_links", "link already exists")
            continue
        db.add(EventMemberLink(**link))
        count += 1
    if count:
        result.restored["member_links"] = count

    count = 0
    for link in snapshot.get("document_links", []):
        if _in_tree(db, Document, link["document_id"], tree.id) is None:
            result.add_skip(
                "document_links", f"document {link['document_id']} no longer exists"
            )
            continue
        if db.get(EventDocumentLink, (event_id, link["document_id"])) is not None:
            result.add_skip("document_links", "link already exists")
            continue
        db.add(EventDocumentLink(**link))
        count += 1
    if count:
        result.restored["document_links"] = count
    return result


def restore_story(db: Session, tree: Tree, snapshot: StorySnapshot) -> RestoreResult:
    story_data = snapshot["story"]
    story_id = story_data["id"]
    if db.get(Story, story_id) is not None:
        raise UndoConflict(f"story {story_id} already exists")
    db.add(Story(**story_data))
    result = RestoreResult(main_id=story_id, restored={"story": story_id})

    count = 0
    for link in snapshot.get("member_links", []):
        if _in_tree(db, Member, link["member_id"], tree.id) is None:
            result.add_skip(
                "member_links", f"member {link['member_id']} no longer exists"
            )
            continue
        if db.get(StoryMemberLink, (story_id, link["member_id"])) is not None:
            result.add_skip("member_links", "link already exists")
            continue
        db.add(StoryMemberLink(**link))
        count += 1
    if count:
        result.restored["member_links"] = count

    count = 0
    for link in snapshot.get("document_links", []):
        if _in_tree(db, Document, link["document_id"], tree.id) is None:
            result.add_skip(
                "document_links", f"document {link['document_id']} no longer exists"
            )
            continue
        if db.get(StoryDocumentLink, (story_id, link["document_id"])) is not None:
            result.add_skip("document_links", "link already exists")
            continue
        db.add(StoryDocumentLink(**link))
        count += 1
    if count:
        result.restored["document_links"] = count
    return result


# ---------------------------------------------------------------------------
# Gallery image / document (+ files) — both carry trashed_media
# ---------------------------------------------------------------------------


def restore_gallery_image(
    db: Session, tree: Tree, snapshot: GalleryImageSnapshot
) -> RestoreResult:
    image_data = snapshot["gallery_image"]
    image_id = image_data["id"]
    if db.get(GalleryImage, image_id) is not None:
        raise UndoConflict(f"gallery image {image_id} already exists")
    db.add(GalleryImage(**image_data))
    result = RestoreResult(
        main_id=image_id,
        restored={"gallery_image": image_id},
        media_to_untrash=list(snapshot.get("trashed_media", [])),
    )

    count = 0
    for link in snapshot.get("member_links", []):
        if _in_tree(db, Member, link["member_id"], tree.id) is None:
            result.add_skip(
                "member_links", f"member {link['member_id']} no longer exists"
            )
            continue
        if db.get(GalleryMemberLink, (image_id, link["member_id"])) is not None:
            result.add_skip("member_links", "link already exists")
            continue
        db.add(GalleryMemberLink(**link))
        count += 1
    if count:
        result.restored["member_links"] = count
    return result


def restore_document(
    db: Session, tree: Tree, snapshot: DocumentSnapshot
) -> RestoreResult:
    doc_data = snapshot["document"]
    doc_id = doc_data["id"]
    if db.get(Document, doc_id) is not None:
        raise UndoConflict(f"document {doc_id} already exists")
    db.add(Document(**doc_data))
    result = RestoreResult(
        main_id=doc_id,
        restored={"document": doc_id},
        media_to_untrash=list(snapshot.get("trashed_media", [])),
    )

    count = 0
    for file_data in snapshot.get("files", []):
        if db.get(DocumentFile, file_data["id"]) is not None:
            result.add_skip("files", "file already exists", file_data["id"])
            continue
        db.add(DocumentFile(**file_data))
        count += 1
    if count:
        result.restored["files"] = count

    count = 0
    for link in snapshot.get("member_links", []):
        if _in_tree(db, Member, link["member_id"], tree.id) is None:
            result.add_skip(
                "member_links", f"member {link['member_id']} no longer exists"
            )
            continue
        if db.get(DocumentMemberLink, (doc_id, link["member_id"])) is not None:
            result.add_skip("member_links", "link already exists")
            continue
        db.add(DocumentMemberLink(**link))
        count += 1
    if count:
        result.restored["member_links"] = count

    count = 0
    for link in snapshot.get("event_links", []):
        if _in_tree(db, Event, link["event_id"], tree.id) is None:
            result.add_skip("event_links", f"event {link['event_id']} no longer exists")
            continue
        if db.get(EventDocumentLink, (link["event_id"], doc_id)) is not None:
            result.add_skip("event_links", "link already exists")
            continue
        db.add(EventDocumentLink(**link))
        count += 1
    if count:
        result.restored["event_links"] = count

    count = 0
    for link in snapshot.get("story_links", []):
        if _in_tree(db, Story, link["story_id"], tree.id) is None:
            result.add_skip("story_links", f"story {link['story_id']} no longer exists")
            continue
        if db.get(StoryDocumentLink, (link["story_id"], doc_id)) is not None:
            result.add_skip("story_links", "link already exists")
            continue
        db.add(StoryDocumentLink(**link))
        count += 1
    if count:
        result.restored["story_links"] = count
    return result


def restore_document_file(
    db: Session, tree: Tree, snapshot: DocumentFileSnapshot
) -> RestoreResult:
    file_data = snapshot["document_file"]
    file_id = file_data["id"]
    if db.get(DocumentFile, file_id) is not None:
        raise UndoConflict(f"document file {file_id} already exists")
    if _in_tree(db, Document, file_data["document_id"], tree.id) is None:
        raise UndoConflict(f"document {file_data['document_id']} no longer exists")
    db.add(DocumentFile(**file_data))
    return RestoreResult(
        main_id=file_id,
        restored={"document_file": file_id},
        media_to_untrash=list(snapshot.get("trashed_media", [])),
    )


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

RESTORERS = {
    "member": restore_member,
    "relation": restore_relation,
    "disease": restore_disease,
    "event": restore_event,
    "story": restore_story,
    "gallery_image": restore_gallery_image,
    "document": restore_document,
    "document_file": restore_document_file,
}

# tree.content_changed domain for each undoable target type (mirrors the
# domain each type's own delete route publishes — see e.g. members.py,
# events.py, stories.py, gallery.py, documents.py).
CONTENT_DOMAIN = {
    "member": "member",
    "relation": "member",
    "disease": "member",
    "event": "event",
    "story": "story",
    "gallery_image": "gallery",
    "document": "document",
    "document_file": "document",
}
