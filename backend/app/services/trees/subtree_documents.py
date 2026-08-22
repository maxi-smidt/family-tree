"""Member-linked-entity and document relocation for sub-tree extraction.

Decides which gallery/event/story entities move with a relocating branch
(``split_linked_entities`` / ``load_member_links``), and copies any document
linked to a moving member/event/story into the new tree so no link ends up
crossing a tree boundary (``copy_documents_for_move``).
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    Tree,
)
from app.services.media.storage import copy_media_to_tree, delete_media

IdMap = dict[str, str]


def split_linked_entities(
    links: list,
    id_attr: str,
    moved: set[str],
) -> tuple[set[str], list]:
    """Partition member-linked entities (gallery / events / stories) for a move.

    An entity whose links ALL point at moved members moves with them; anything
    with mixed links stays in the source tree and its links to moved members
    are dropped. Returns ``(moved_entity_ids, stale_links_to_delete)``.
    Entities without member links never show up here and stay untouched.
    """
    by_entity: dict[str, list] = {}
    for lnk in links:
        by_entity.setdefault(getattr(lnk, id_attr), []).append(lnk)
    moved_ids: set[str] = set()
    stale_links: list = []
    for entity_id, entity_links in by_entity.items():
        if all(lnk.member_id in moved for lnk in entity_links):
            moved_ids.add(entity_id)
        else:
            stale_links.extend(
                lnk for lnk in entity_links if lnk.member_id in moved
            )
    return moved_ids, stale_links


def load_member_links(db: Session, tree_id: str) -> tuple[list, list, list]:
    """All gallery/event/story member links of a tree (link tables carry no
    tree_id, so they are reached through their tree-scoped entity)."""
    gallery_links = list(
        db.scalars(
            select(GalleryMemberLink)
            .join(GalleryImage, GalleryImage.id == GalleryMemberLink.gallery_image_id)
            .where(GalleryImage.tree_id == tree_id)
        )
    )
    event_links = list(
        db.scalars(
            select(EventMemberLink)
            .join(Event, Event.id == EventMemberLink.event_id)
            .where(Event.tree_id == tree_id)
        )
    )
    story_links = list(
        db.scalars(
            select(StoryMemberLink)
            .join(Story, Story.id == StoryMemberLink.story_id)
            .where(Story.tree_id == tree_id)
        )
    )
    return gallery_links, event_links, story_links


def linked_document_ids(
    db: Session,
    source_tree_id: str,
    *,
    moved_member_ids: set[str],
    moved_event_ids: set[str],
    moved_story_ids: set[str],
) -> set[str]:
    """Document ids (of ``source_tree_id``) linked to any moving entity.

    Documents are reusable, tree-scoped content; a document linked to a member,
    event, or story that is relocating must be copied into the new tree so no
    link ends up crossing a tree boundary.
    """
    doc_ids: set[str] = set()
    if moved_member_ids:
        doc_ids |= set(
            db.scalars(
                select(DocumentMemberLink.document_id)
                .join(Document, Document.id == DocumentMemberLink.document_id)
                .where(
                    Document.tree_id == source_tree_id,
                    DocumentMemberLink.member_id.in_(moved_member_ids),
                )
            )
        )
    if moved_event_ids:
        doc_ids |= set(
            db.scalars(
                select(EventDocumentLink.document_id)
                .join(Document, Document.id == EventDocumentLink.document_id)
                .where(
                    Document.tree_id == source_tree_id,
                    EventDocumentLink.event_id.in_(moved_event_ids),
                )
            )
        )
    if moved_story_ids:
        doc_ids |= set(
            db.scalars(
                select(StoryDocumentLink.document_id)
                .join(Document, Document.id == StoryDocumentLink.document_id)
                .where(
                    Document.tree_id == source_tree_id,
                    StoryDocumentLink.story_id.in_(moved_story_ids),
                )
            )
        )
    return doc_ids


def copy_documents_for_move(
    db: Session,
    source_tree: Tree,
    new_tree: Tree,
    *,
    moved_member_ids: set[str],
    moved_event_ids: set[str],
    moved_story_ids: set[str],
) -> None:
    """Copy documents linked to moving entities into ``new_tree`` and repoint.

    Every document linked (member/event/story) to a relocating entity is copied
    — with its files (``copy_media_to_tree`` for ``kind == "file"``) — into the
    new tree, and the moving entities' link rows are repointed to the copy. The
    original stays behind to serve any links from entities that did not move, so
    no link ever crosses a tree boundary.
    """
    doc_ids = linked_document_ids(
        db,
        source_tree.id,
        moved_member_ids=moved_member_ids,
        moved_event_ids=moved_event_ids,
        moved_story_ids=moved_story_ids,
    )
    if not doc_ids:
        return

    doc_copy_map: IdMap = {}
    for old_doc_id in doc_ids:
        doc = db.get(Document, old_doc_id)
        if doc is None:
            continue
        new_doc_id = str(uuid4())
        doc_copy_map[old_doc_id] = new_doc_id
        db.add(
            Document(
                id=new_doc_id,
                tree_id=new_tree.id,
                title=doc.title,
                document_date=doc.document_date,
                description=doc.description,
                created_at=doc.created_at,
                updated_at=doc.updated_at,
            )
        )
        for f in db.scalars(
            select(DocumentFile).where(DocumentFile.document_id == old_doc_id)
        ):
            new_url = f.url
            if f.kind == "file":
                new_url = copy_media_to_tree(f.url, new_tree.id) or f.url
            db.add(
                DocumentFile(
                    id=str(uuid4()),
                    tree_id=new_tree.id,
                    document_id=new_doc_id,
                    kind=f.kind,
                    filename=f.filename,
                    url=new_url,
                    mime_type=f.mime_type,
                    size=f.size,
                    created_at=f.created_at,
                )
            )
    db.flush()  # copied documents must exist before repointed links reference them

    # Repoint the moving entities' link rows to the copied documents. Collect
    # the target pairs first, then delete the old rows and add the new ones, so
    # the result cursors aren't mutated mid-iteration.
    member_links = list(
        db.scalars(
            select(DocumentMemberLink)
            .join(Document, Document.id == DocumentMemberLink.document_id)
            .where(
                Document.tree_id == source_tree.id,
                DocumentMemberLink.member_id.in_(moved_member_ids),
            )
        )
    ) if moved_member_ids else []
    event_links = list(
        db.scalars(
            select(EventDocumentLink)
            .join(Document, Document.id == EventDocumentLink.document_id)
            .where(
                Document.tree_id == source_tree.id,
                EventDocumentLink.event_id.in_(moved_event_ids),
            )
        )
    ) if moved_event_ids else []
    story_links = list(
        db.scalars(
            select(StoryDocumentLink)
            .join(Document, Document.id == StoryDocumentLink.document_id)
            .where(
                Document.tree_id == source_tree.id,
                StoryDocumentLink.story_id.in_(moved_story_ids),
            )
        )
    ) if moved_story_ids else []

    new_member_links = [
        (doc_copy_map[link.document_id], link.member_id)
        for link in member_links
        if link.document_id in doc_copy_map
    ]
    new_event_links = [
        (link.event_id, doc_copy_map[link.document_id])
        for link in event_links
        if link.document_id in doc_copy_map
    ]
    new_story_links = [
        (link.story_id, doc_copy_map[link.document_id])
        for link in story_links
        if link.document_id in doc_copy_map
    ]
    for link in (*member_links, *event_links, *story_links):
        if link.document_id in doc_copy_map:
            db.delete(link)
    db.flush()
    for doc_id, member_id in new_member_links:
        db.add(DocumentMemberLink(document_id=doc_id, member_id=member_id))
    for event_id, doc_id in new_event_links:
        db.add(EventDocumentLink(event_id=event_id, document_id=doc_id))
    for story_id, doc_id in new_story_links:
        db.add(StoryDocumentLink(story_id=story_id, document_id=doc_id))
    db.flush()

    # Any source document that was linked ONLY to moved entities now has all
    # its links repointed to the copy and is left orphaned — clean it up.
    _gc_orphaned_documents(db, source_tree.id, set(doc_copy_map))


def _gc_orphaned_documents(
    db: Session, source_tree_id: str, doc_ids: set[str]
) -> None:
    """Delete source-tree documents left with no links after a move.

    ``doc_ids`` are the documents the move touched (linked to a relocating
    entity, hence copied and repointed). A document linked *only* to moved
    entities is left with zero member/event/story links once repointing is
    done; it would otherwise linger as an orphan in the source tree. Such a
    document, its ``DocumentFile`` rows, and the underlying stored files are
    removed. Restricting to the touched documents avoids sweeping away
    documents the user deliberately left unlinked.
    """
    for doc_id in doc_ids:
        doc = db.get(Document, doc_id)
        if doc is None or doc.tree_id != source_tree_id:
            continue
        has_link = any(
            db.scalar(
                select(link_model.document_id)
                .where(link_model.document_id == doc_id)
                .limit(1)
            )
            is not None
            for link_model in (
                DocumentMemberLink,
                EventDocumentLink,
                StoryDocumentLink,
            )
        )
        if has_link:
            continue
        for f in doc.files:
            if f.kind == "file":
                delete_media(f.url)
        db.delete(doc)
    db.flush()
