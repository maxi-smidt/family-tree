"""Sub-tree extraction service.

Moves a connected branch of an existing tree into a brand-new tree, keeping
member ids. The root stays behind in the source tree as the bridge person
(tree-in-tree link) with a fresh counterpart seeded in the new tree, and
relations crossing the cut elsewhere are severed.

The branch is selected by picking a root member and one of two ``direction``
values — see ``app.services.workspaces.subtree_selection`` for the traversal rules.
Gallery/event/story relocation and the document copy-and-repoint that keeps
every link inside its own tree live in ``app.services.workspaces.subtree_documents``.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import role_for
from app.core.exceptions import (
    AccessDeniedError,
    ConflictError,
    InvalidInputError,
    NotFoundError,
)
from app.db.base import utcnow_iso
from app.models import (
    ContentType,
    DocumentFile,
    Event,
    GalleryImage,
    GalleryUnknownFace,
    Member,
    MemberDisease,
    MemberTask,
    Relation,
    Story,
    User,
    Workspace,
)
from app.schemas.extract import SubtreeExtractRequest, SubtreePreview
from app.services.activity.activity import record_activity
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_workspace_event
from app.services.media.storage import media_disk_usage, move_media_to_tree
from app.services.members.member_clone import clone_member, wire_bridge
from app.services.provenance import rehome_scopes
from app.services.system.job_service import ProgressCallback
from app.services.unit_of_work import UnitOfWork
from app.services.workspaces.subtree_documents import (
    copy_documents_for_move,
    linked_document_ids,
    load_member_links,
    split_linked_entities,
)
from app.services.workspaces.subtree_selection import (
    classify_relations,
    collect_member_ids,
)
from app.services.workspaces.workspace_state import mark_workspace_opened


def _require_readable(db: Session, user: User, workspace_id: str) -> Workspace:
    tree = db.get(Workspace, workspace_id)
    if tree is None or role_for(db, tree, user) is None:
        raise NotFoundError("Source tree not found")
    return tree


def validate_move_request(
    db: Session,
    user: User,
    req: SubtreeExtractRequest,
) -> tuple[Workspace, Member]:
    """Validate an extraction request without writing anything.

    Called synchronously from the endpoint before the background job is
    created, so precondition failures surface as 4xx responses instead of a
    failed job. Returns the source tree and the root (future bridge) member.
    """
    # direction is a Pydantic Literal, so any value that reaches here is
    # already one of the valid choices — no runtime check needed.
    tree = _require_readable(db, user, req.source_workspace_id)
    if tree.owner_id != user.id:
        raise AccessDeniedError(
            "Only the tree owner can extract a branch into a new tree"
        )
    root = db.scalar(
        select(Member).where(
            Member.workspace_id == tree.id, Member.id == req.root_member_id
        )
    )
    if root is None:
        raise NotFoundError("Root member not found in tree")
    if root.linked_workspace_id is not None:
        raise ConflictError("Member is already linked to a tree")
    return tree, root


def compute_subtree_preview(
    db: Session,
    user: User,
    req: SubtreeExtractRequest,
) -> SubtreePreview:
    """Preview an extraction without writing anything (same checks as the move)."""
    tree, root = validate_move_request(db, user, req)
    member_ids = collect_member_ids(db, tree.id, root.id, req.direction)
    moved = member_ids - {root.id}
    relations = list(db.scalars(select(Relation).where(Relation.workspace_id == tree.id)))
    kept, bridged, severed = classify_relations(relations, moved, root.id)

    media_bytes = 0
    if moved:
        for image_data in db.scalars(
            select(Member.image_data).where(
                Member.workspace_id == tree.id, Member.id.in_(moved)
            )
        ):
            media_bytes += media_disk_usage(image_data)
        gallery_links, event_links, story_links = load_member_links(db, tree.id)
        moved_image_ids, _ = split_linked_entities(
            gallery_links, "gallery_image_id", moved
        )
        if moved_image_ids:
            for image_data in db.scalars(
                select(GalleryImage.image_data).where(
                    GalleryImage.workspace_id == tree.id,
                    GalleryImage.id.in_(moved_image_ids),
                )
            ):
                media_bytes += media_disk_usage(image_data)
        # Documents linked to any moving entity (member, event, or story) are
        # copied into the new tree, so their file bytes count toward it.
        moved_event_ids, _ = split_linked_entities(event_links, "event_id", moved)
        moved_story_ids, _ = split_linked_entities(story_links, "story_id", moved)
        doc_ids = linked_document_ids(
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
) -> Workspace:
    """Move the selected branch into a new tree linked through the root."""

    def _progress(pct: int) -> None:
        if progress_cb is not None:
            progress_cb(pct)

    tree, root = validate_move_request(db, user, req)
    member_ids = collect_member_ids(db, tree.id, root.id, req.direction)
    moved = member_ids - {root.id}
    if not moved:
        raise InvalidInputError(
            "Nothing to move: the selection contains only the root member"
        )
    _progress(10)

    new_tree = Workspace(
        id=str(uuid4()),
        name=req.name,
        owner_id=user.id,
        created_at=utcnow_iso(),
    )
    db.add(new_tree)
    db.flush()
    mark_workspace_opened(db, new_tree.id, user.id)

    # --- Bridge person ---
    # The root stays in the source tree; a clone (photo copied, not moved)
    # seeds the new tree and the two rows link both ways.
    counterpart = clone_member(root, new_tree.id, str(uuid4()))
    counterpart.position_x = 0
    counterpart.position_y = 0
    counterpart.is_collapsed = False
    db.add(counterpart)
    db.flush()

    wire_bridge(root, counterpart)
    # The branch is gone; the linked-tree badge replaces the collapse chip.
    root.is_collapsed = False
    _progress(25)

    # --- Members: keep ids, re-point the tree, relocate photos on disk ---
    for m in db.scalars(
        select(Member).where(Member.workspace_id == tree.id, Member.id.in_(moved))
    ):
        m.workspace_id = new_tree.id
        m.image_data = move_media_to_tree(m.image_data, new_tree.id)
        # Zeroed out like the bridge counterpart: all-zero positions mark a
        # never-arranged tree, which the frontend auto-lays-out on first open
        # rather than opening with stale positions carried over from the
        # source tree (which would leave the new tree sparse and disjoint).
        m.position_x = 0
        m.position_y = 0
    _progress(45)

    # --- Relations ---
    # workspace_id is part of the composite PK, so rows are deleted and recreated
    # in the new tree rather than mutated in place.
    relations = list(db.scalars(select(Relation).where(Relation.workspace_id == tree.id)))
    kept, bridged, severed = classify_relations(relations, moved, root.id)
    for r in (*kept, *bridged, *severed):
        db.delete(r)
    db.flush()
    for r in kept:
        db.add(
            Relation(
                workspace_id=new_tree.id,
                from_member_id=r.from_member_id,
                to_member_id=r.to_member_id,
                relation_type=r.relation_type,
            )
        )
    for r in bridged:
        db.add(
            Relation(
                workspace_id=new_tree.id,
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
    moved_disease_ids: list[str] = []
    for d in db.scalars(
        select(MemberDisease).where(MemberDisease.workspace_id == tree.id)
    ):
        if d.member_id in moved:
            d.workspace_id = new_tree.id
            moved_disease_ids.append(d.id)
    rehome_scopes(
        db,
        content_type=ContentType.DISEASE,
        content_ids=moved_disease_ids,
        workspace_id=new_tree.id,
    )

    # --- Gallery / events / stories ---
    # Entities whose member links ALL point at moved members follow the move
    # (ids are stable, so the link rows keep working); entities with mixed
    # links stay behind and just drop their links to moved members.
    gallery_links, event_links, story_links = load_member_links(db, tree.id)

    moved_image_ids, stale_gallery_links = split_linked_entities(
        gallery_links, "gallery_image_id", moved
    )
    if moved_image_ids:
        for img in db.scalars(
            select(GalleryImage).where(
                GalleryImage.workspace_id == tree.id,
                GalleryImage.id.in_(moved_image_ids),
            )
        ):
            img.workspace_id = new_tree.id
            img.image_data = move_media_to_tree(img.image_data, new_tree.id)
        rehome_scopes(
            db,
            content_type=ContentType.GALLERY_IMAGE,
            content_ids=moved_image_ids,
            workspace_id=new_tree.id,
        )
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
                    MemberTask.workspace_id == tree.id,
                    MemberTask.done.is_(False),
                )
            ):
                db.delete(task)
        for face in moved_faces:
            face.task_id = None
    for lnk in stale_gallery_links:
        db.delete(lnk)
    _progress(70)

    moved_event_ids, stale_event_links = split_linked_entities(
        event_links, "event_id", moved
    )
    if moved_event_ids:
        for e in db.scalars(
            select(Event).where(
                Event.workspace_id == tree.id, Event.id.in_(moved_event_ids)
            )
        ):
            e.workspace_id = new_tree.id
        rehome_scopes(
            db,
            content_type=ContentType.EVENT,
            content_ids=moved_event_ids,
            workspace_id=new_tree.id,
        )
    for lnk in stale_event_links:
        db.delete(lnk)
    _progress(78)

    moved_story_ids, stale_story_links = split_linked_entities(
        story_links, "story_id", moved
    )
    if moved_story_ids:
        for s in db.scalars(
            select(Story).where(
                Story.workspace_id == tree.id, Story.id.in_(moved_story_ids)
            )
        ):
            s.workspace_id = new_tree.id
        rehome_scopes(
            db,
            content_type=ContentType.STORY,
            content_ids=moved_story_ids,
            workspace_id=new_tree.id,
        )
    for lnk in stale_story_links:
        db.delete(lnk)
    _progress(84)

    # --- Documents ---
    # Documents are reusable, tree-scoped content: any document linked to a
    # moving member/event/story is copied (with its files) into the new tree
    # and the moving entity's link is repointed to the copy, so no link ever
    # crosses a tree boundary. The original stays behind for any links from
    # entities that did not move.
    copy_documents_for_move(
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
    with UnitOfWork(db) as uow:
        record_activity(
            db,
            workspace_id=tree.id,
            actor=user,
            action="update",
            target_type="member",
            target_id=root.id,
            target_label=label,
            details={
                "after": {"linked_workspace_id": new_tree.id},
                "moved_member_count": len(moved),
                "severed_relation_count": len(severed),
            },
        )
        uow.after_commit(lambda: invalidate_stats(tree.id))
        uow.after_commit(
            lambda: publish_workspace_event(
                db, tree, "activity.entry_added", {"workspace_id": tree.id}
            )
        )
        uow.after_commit(
            lambda: publish_workspace_event(
                db,
                tree,
                "workspace.content_changed",
                {"workspace_id": tree.id, "domain": "member"},
            )
        )
    db.refresh(new_tree)
    _progress(95)
    return new_tree
