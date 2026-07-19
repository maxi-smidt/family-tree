"""Sub-tree extraction service.

Moves a connected branch of an existing tree into a brand-new tree, keeping
member ids. The root stays behind in the source tree as the bridge person
(tree-in-tree link) with a fresh counterpart seeded in the new tree, and
relations crossing the cut elsewhere are severed.

The branch is selected by picking a root member and one of two ``direction``
values:

- ``direct_family`` (default): the root's family of origin — parents,
  siblings and their branches, with married-in spouses. The root's own
  children never move. See ``_collect_direct_family_ids``.
- ``partnership``: the root's partner(s), the partner's family, and the
  children the root shares with them. See ``_collect_partnership_ids``.
"""

from __future__ import annotations

from collections import deque
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import role_for
from app.db.base import utcnow_iso
from app.models import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    GalleryUnknownFace,
    Member,
    MemberDisease,
    MemberTask,
    Relation,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    Tree,
    User,
)
from app.schemas.extract import SubtreeExtractRequest, SubtreePreview
from app.services import feature_service
from app.services.activity import record_activity
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_tree_event
from app.services.job_service import ProgressCallback
from app.services.merge import _clone_member, _wire_bridge
from app.services.storage import (
    copy_media_to_tree,
    delete_media,
    media_disk_usage,
    move_media_to_tree,
)


def _require_readable(db: Session, user: User, tree_id: str) -> Tree:
    tree = db.get(Tree, tree_id)
    if tree is None or role_for(db, tree, user) is None:
        raise HTTPException(status_code=404, detail="Source tree not found")
    return tree


def _load_relations(db: Session, tree_id: str) -> list[Relation]:
    return list(db.scalars(select(Relation).where(Relation.tree_id == tree_id)))


def _pull_one_hop_partners(
    relations: list[Relation], moved: set[str], root_id: str
) -> None:
    """Add, in place, everyone sharing a non-parent (partner-like) relation
    with a member already in ``moved`` — a single hop, no further traversal
    from the pulled-in members. Partners of the root itself are excluded
    (the root is the bridge, never in ``moved``)."""
    peers: set[str] = set()
    for r in relations:
        if r.relation_type == "parent":
            continue
        if r.from_member_id == root_id or r.to_member_id == root_id:
            continue
        if r.from_member_id in moved:
            peers.add(r.to_member_id)
        if r.to_member_id in moved:
            peers.add(r.from_member_id)
    moved |= peers


def _collect_direct_family_ids(
    db: Session, tree_id: str, root_id: str
) -> set[str]:
    """"Direct family" selection: the root's family of origin.

    The root R stays as the bridge; R's own children/descendants do NOT
    move (they belong to R's partnership in the main tree).

    1. Build the vertical (parent-edge) adjacency, traversable both ways.
    2. moved = BFS over vertical edges starting from R's PARENTS (rows
       where from=R: their to-members), never visiting R itself. This
       yields parents, grandparents, siblings (down from parents),
       aunts/uncles/cousins (down from higher ancestors) — but never R's
       own children, since downward traversal from R never happens (and
       any path back down to them passes through R, which is blocked).
    3. One-hop partner pull: every member sharing a non-parent relation
       with a moved member is added to moved (single hop, no further
       traversal) — e.g. a moved brother's wife comes along instead of
       being severed. Partners of R itself are NOT pulled.
    4. R is excluded from the returned set (it is the bridge).
    """
    relations = _load_relations(db, tree_id)

    vertical: dict[str, set[str]] = {}

    def link(a: str, b: str) -> None:
        vertical.setdefault(a, set()).add(b)
        vertical.setdefault(b, set()).add(a)

    root_parents: set[str] = set()
    for r in relations:
        if r.relation_type != "parent":
            continue
        link(r.from_member_id, r.to_member_id)
        if r.from_member_id == root_id:
            root_parents.add(r.to_member_id)

    moved: set[str] = set()
    queue: deque[str] = deque()
    for p in root_parents:
        if p not in moved:
            moved.add(p)
            queue.append(p)
    while queue:
        node = queue.popleft()
        for nb in vertical.get(node, ()):
            if nb == root_id or nb in moved:
                continue
            moved.add(nb)
            queue.append(nb)

    _pull_one_hop_partners(relations, moved, root_id)
    moved.discard(root_id)
    return moved


def _collect_partnership_ids(
    db: Session, tree_id: str, root_id: str
) -> set[str]:
    """"Partnership" selection: the root's partner(s) and their world, plus
    the shared children.

    The root R stays as the bridge; the partner side and the shared children
    move.

    1. seeds = all of R's partners (members sharing any non-parent relation
       with R) + all of R's children (parent rows where to=R: their
       from-members).
    2. moved = BFS from all seeds over ALL edges (vertical + horizontal),
       never visiting R.
    3. R is excluded from the returned set (it is the bridge).

    Deliberately simple: in tangled trees (e.g. two siblings married into
    the same family) this can reach back into the root's own blood family —
    accepted; the preview's member count reveals it. No cleverness is added
    to prevent that (unlike "direct family", which has no such need since it
    never leaves the vertical axis until the one-hop partner pull).
    """
    relations = _load_relations(db, tree_id)

    adjacency: dict[str, set[str]] = {}

    def link(a: str, b: str) -> None:
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)

    seeds: set[str] = set()
    for r in relations:
        link(r.from_member_id, r.to_member_id)
        if r.relation_type == "parent":
            # from = child, to = parent. Root's children: root is the parent.
            if r.to_member_id == root_id:
                seeds.add(r.from_member_id)
        else:
            if r.from_member_id == root_id:
                seeds.add(r.to_member_id)
            elif r.to_member_id == root_id:
                seeds.add(r.from_member_id)

    moved: set[str] = set()
    queue: deque[str] = deque()
    for s in seeds:
        if s not in moved:
            moved.add(s)
            queue.append(s)
    while queue:
        node = queue.popleft()
        for nb in adjacency.get(node, ()):
            if nb == root_id or nb in moved:
                continue
            moved.add(nb)
            queue.append(nb)

    return moved


def _collect_member_ids(
    db: Session, tree_id: str, root_id: str, direction: str
) -> set[str]:
    """Return the set of member ids that belong in the sub-tree for ``direction``."""
    root = db.scalar(
        select(Member).where(Member.tree_id == tree_id, Member.id == root_id)
    )
    if root is None:
        raise HTTPException(status_code=404, detail="Root member not found in tree")

    if direction == "partnership":
        return _collect_partnership_ids(db, tree_id, root_id)
    return _collect_direct_family_ids(db, tree_id, root_id)


def validate_move_request(
    db: Session,
    user: User,
    req: SubtreeExtractRequest,
) -> tuple[Tree, Member]:
    """Validate an extraction request without writing anything.

    Called synchronously from the endpoint before the background job is
    created, so precondition failures surface as 4xx responses instead of a
    failed job. Returns the source tree and the root (future bridge) member.
    """
    # direction is a Pydantic Literal, so any value that reaches here is
    # already one of the valid choices — no runtime check needed.
    # Extraction creates a tree-in-tree link; gate exactly like member subtrees.
    if not feature_service.is_enabled(db, "tree_links", user):
        raise HTTPException(status_code=404, detail="Not found")
    tree = _require_readable(db, user, req.source_tree_id)
    if tree.owner_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="Only the tree owner can extract a branch into a new tree",
        )
    root = db.scalar(
        select(Member).where(
            Member.tree_id == tree.id, Member.id == req.root_member_id
        )
    )
    if root is None:
        raise HTTPException(status_code=404, detail="Root member not found in tree")
    if root.linked_tree_id is not None:
        raise HTTPException(
            status_code=409, detail="Member is already linked to a tree"
        )
    return tree, root


def _classify_relations(
    relations: list[Relation],
    moved: set[str],
    root_id: str,
) -> tuple[list[Relation], list[Relation], list[Relation]]:
    """Split a source tree's relations for a move.

    Returns ``(kept, bridged, severed)``:

    - kept: both endpoints move → recreated as-is in the new tree,
    - bridged: root ↔ moved → recreated with the root replaced by its
      counterpart (the bridge person carries the seam),
    - severed: moved ↔ anything staying (other than the root) → deleted.

    Relations entirely among staying members are not returned (untouched).
    """
    kept: list[Relation] = []
    bridged: list[Relation] = []
    severed: list[Relation] = []
    for r in relations:
        from_moved = r.from_member_id in moved
        to_moved = r.to_member_id in moved
        if from_moved and to_moved:
            kept.append(r)
        elif from_moved or to_moved:
            other = r.to_member_id if from_moved else r.from_member_id
            if other == root_id:
                bridged.append(r)
            else:
                severed.append(r)
    return kept, bridged, severed


def _split_linked_entities(
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


def _load_member_links(db: Session, tree_id: str) -> tuple[list, list, list]:
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


def _linked_document_ids(
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


def _copy_documents_for_move(
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
    doc_ids = _linked_document_ids(
        db,
        source_tree.id,
        moved_member_ids=moved_member_ids,
        moved_event_ids=moved_event_ids,
        moved_story_ids=moved_story_ids,
    )
    if not doc_ids:
        return

    doc_copy_map: dict[str, str] = {}
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


def compute_subtree_preview(
    db: Session,
    user: User,
    req: SubtreeExtractRequest,
) -> SubtreePreview:
    """Preview an extraction without writing anything (same checks as the move)."""
    tree, root = validate_move_request(db, user, req)
    member_ids = _collect_member_ids(db, tree.id, root.id, req.direction)
    moved = member_ids - {root.id}
    relations = list(db.scalars(select(Relation).where(Relation.tree_id == tree.id)))
    kept, bridged, severed = _classify_relations(relations, moved, root.id)

    media_bytes = 0
    if moved:
        for image_data in db.scalars(
            select(Member.image_data).where(
                Member.tree_id == tree.id, Member.id.in_(moved)
            )
        ):
            media_bytes += media_disk_usage(image_data)
        gallery_links, event_links, story_links = _load_member_links(db, tree.id)
        moved_image_ids, _ = _split_linked_entities(
            gallery_links, "gallery_image_id", moved
        )
        if moved_image_ids:
            for image_data in db.scalars(
                select(GalleryImage.image_data).where(
                    GalleryImage.tree_id == tree.id,
                    GalleryImage.id.in_(moved_image_ids),
                )
            ):
                media_bytes += media_disk_usage(image_data)
        # Documents linked to any moving entity (member, event, or story) are
        # copied into the new tree, so their file bytes count toward it.
        moved_event_ids, _ = _split_linked_entities(event_links, "event_id", moved)
        moved_story_ids, _ = _split_linked_entities(story_links, "story_id", moved)
        doc_ids = _linked_document_ids(
            db,
            tree.id,
            moved_member_ids=moved,
            moved_event_ids=moved_event_ids,
            moved_story_ids=moved_story_ids,
        )
        if doc_ids:
            for url in db.scalars(
                select(DocumentFile.url).where(
                    DocumentFile.document_id.in_(doc_ids),
                    DocumentFile.kind == "file",
                )
            ):
                media_bytes += media_disk_usage(url)

    return SubtreePreview(
        member_count=len(moved),
        relation_count=len(kept) + len(bridged),
        severed_relation_count=len(severed),
        media_bytes=media_bytes,
    )


def extract_subtree(
    db: Session,
    user: User,
    req: SubtreeExtractRequest,
    progress_cb: ProgressCallback | None = None,
) -> Tree:
    """Move the selected branch into a new tree linked through the root."""

    def _progress(pct: int) -> None:
        if progress_cb is not None:
            progress_cb(pct)

    tree, root = validate_move_request(db, user, req)
    member_ids = _collect_member_ids(db, tree.id, root.id, req.direction)
    moved = member_ids - {root.id}
    if not moved:
        raise HTTPException(
            status_code=400,
            detail="Nothing to move: the selection contains only the root member",
        )
    _progress(10)

    new_tree = Tree(
        id=str(uuid4()),
        name=req.name,
        owner_id=user.id,
        created_at=utcnow_iso(),
        last_opened=utcnow_iso(),
    )
    db.add(new_tree)
    db.flush()

    # --- Bridge person ---
    # The root stays in the source tree; a clone (photo copied, not moved)
    # seeds the new tree and the two rows link both ways.
    counterpart = _clone_member(root, new_tree.id, str(uuid4()))
    counterpart.position_x = 0
    counterpart.position_y = 0
    counterpart.is_collapsed = False
    db.add(counterpart)
    db.flush()

    _wire_bridge(root, counterpart)
    # The branch is gone; the linked-tree badge replaces the collapse chip.
    root.is_collapsed = False
    _progress(25)

    # --- Members: keep ids, re-point the tree, relocate photos on disk ---
    for m in db.scalars(
        select(Member).where(Member.tree_id == tree.id, Member.id.in_(moved))
    ):
        m.tree_id = new_tree.id
        m.image_data = move_media_to_tree(m.image_data, new_tree.id)
        # Zeroed out like the bridge counterpart: all-zero positions mark a
        # never-arranged tree, which the frontend auto-lays-out on first open
        # rather than opening with stale positions carried over from the
        # source tree (which would leave the new tree sparse and disjoint).
        m.position_x = 0
        m.position_y = 0
    _progress(45)

    # --- Relations ---
    # tree_id is part of the composite PK, so rows are deleted and recreated
    # in the new tree rather than mutated in place.
    relations = list(db.scalars(select(Relation).where(Relation.tree_id == tree.id)))
    kept, bridged, severed = _classify_relations(relations, moved, root.id)
    for r in (*kept, *bridged, *severed):
        db.delete(r)
    db.flush()
    for r in kept:
        db.add(
            Relation(
                tree_id=new_tree.id,
                from_member_id=r.from_member_id,
                to_member_id=r.to_member_id,
                relation_type=r.relation_type,
            )
        )
    for r in bridged:
        db.add(
            Relation(
                tree_id=new_tree.id,
                from_member_id=(
                    counterpart.id if r.from_member_id == root.id else r.from_member_id
                ),
                to_member_id=(
                    counterpart.id if r.to_member_id == root.id else r.to_member_id
                ),
                relation_type=r.relation_type,
            )
        )
    _progress(60)

    # --- Diseases (tree-scoped rows of moved members follow them) ---
    for d in db.scalars(select(MemberDisease).where(MemberDisease.tree_id == tree.id)):
        if d.member_id in moved:
            d.tree_id = new_tree.id

    # --- Gallery / events / stories ---
    # Entities whose member links ALL point at moved members follow the move
    # (ids are stable, so the link rows keep working); entities with mixed
    # links stay behind and just drop their links to moved members.
    gallery_links, event_links, story_links = _load_member_links(db, tree.id)

    moved_image_ids, stale_gallery_links = _split_linked_entities(
        gallery_links, "gallery_image_id", moved
    )
    if moved_image_ids:
        for img in db.scalars(
            select(GalleryImage).where(
                GalleryImage.tree_id == tree.id,
                GalleryImage.id.in_(moved_image_ids),
            )
        ):
            img.tree_id = new_tree.id
            img.image_data = move_media_to_tree(img.image_data, new_tree.id)
        # Unknown-face rows follow their image automatically (they're reached
        # only through gallery_image_id, which is unchanged), but the research
        # task they created lives in MemberTask, which never moves with this
        # extraction. A face whose task is still open here is no longer
        # actionable in the source tree, so the task is deleted; a done task is
        # kept as history either way. The face's task_id is always cleared so
        # it never points at a task in another tree.
        moved_faces = list(
            db.scalars(
                select(GalleryUnknownFace).where(
                    GalleryUnknownFace.gallery_image_id.in_(moved_image_ids)
                )
            )
        )
        task_ids = {f.task_id for f in moved_faces if f.task_id}
        if task_ids:
            for task in db.scalars(
                select(MemberTask).where(
                    MemberTask.id.in_(task_ids),
                    MemberTask.tree_id == tree.id,
                    MemberTask.done.is_(False),
                )
            ):
                db.delete(task)
        for face in moved_faces:
            face.task_id = None
    for lnk in stale_gallery_links:
        db.delete(lnk)
    _progress(70)

    moved_event_ids, stale_event_links = _split_linked_entities(
        event_links, "event_id", moved
    )
    if moved_event_ids:
        for e in db.scalars(
            select(Event).where(
                Event.tree_id == tree.id, Event.id.in_(moved_event_ids)
            )
        ):
            e.tree_id = new_tree.id
    for lnk in stale_event_links:
        db.delete(lnk)
    _progress(78)

    moved_story_ids, stale_story_links = _split_linked_entities(
        story_links, "story_id", moved
    )
    if moved_story_ids:
        for s in db.scalars(
            select(Story).where(
                Story.tree_id == tree.id, Story.id.in_(moved_story_ids)
            )
        ):
            s.tree_id = new_tree.id
    for lnk in stale_story_links:
        db.delete(lnk)
    _progress(84)

    # --- Documents ---
    # Documents are reusable, tree-scoped content: any document linked to a
    # moving member/event/story is copied (with its files) into the new tree
    # and the moving entity's link is repointed to the copy, so no link ever
    # crosses a tree boundary. The original stays behind for any links from
    # entities that did not move.
    _copy_documents_for_move(
        db,
        tree,
        new_tree,
        moved_member_ids=moved,
        moved_event_ids=moved_event_ids,
        moved_story_ids=moved_story_ids,
    )
    _progress(88)

    # --- Bookkeeping ---
    label = " ".join(filter(None, [root.first_name, root.last_name])) or None
    record_activity(
        db,
        tree_id=tree.id,
        actor=user,
        action="update",
        target_type="member",
        target_id=root.id,
        target_label=label,
        details={
            "after": {"linked_tree_id": new_tree.id},
            "moved_member_count": len(moved),
            "severed_relation_count": len(severed),
        },
    )
    db.commit()
    invalidate_stats(tree.id)
    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    publish_tree_event(
        db, tree, "tree.content_changed", {"tree_id": tree.id, "domain": "member"}
    )
    db.refresh(new_tree)
    _progress(95)
    return new_tree
