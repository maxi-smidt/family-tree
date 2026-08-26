"""Per-content-domain copiers used by ``app.services.workspaces.merge.merge_trees``.

Each function copies one content domain (sections, relations, diseases,
tasks, gallery, events, stories, documents) from every source tree in
``MergeContext.sources`` into the new tree, deduplicating link rows that
would otherwise be recreated once per source. Every id remap a later domain
needs (e.g. documents linking to events/stories) is read from
``MergeContext``; a domain that produces ids other content links against
writes its map back onto the context.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.models import (
    ContentScope,
    ContentType,
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    GalleryUnknownFace,
    MemberDisease,
    MemberTask,
    MemberTaskLink,
    Relation,
    SavedView,
    SavedViewPosition,
    SavedViewSection,
    Section,
    SectionMember,
    SectionPosition,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    Workspace,
)
from app.services.media.storage import copy_media_to_workspace
from app.services.members.member_clone import norm
from app.services.provenance import scope_of

IdMap = dict[str, str]


@dataclass
class MergeContext:
    """Id maps and source/target workspaces threaded through the copy phase.

    ``member_map`` (source member id → new-tree member id) is built by the
    member de-duplication pass before any copier below runs; ``section_map``
    is built by ``copy_sections``, which must run before any content copier
    that calls ``_carry_scope``; the rest start empty and are filled in by
    their own domain's copier as content is copied, so later domains
    (documents) can follow the links.
    """

    new_tree_id: str
    sources: list[Workspace]
    member_map: IdMap
    section_map: IdMap = field(default_factory=dict)
    task_id_map: IdMap = field(default_factory=dict)
    image_map: IdMap = field(default_factory=dict)
    event_map: IdMap = field(default_factory=dict)
    story_map: IdMap = field(default_factory=dict)
    document_map: IdMap = field(default_factory=dict)


def _carry_scope(
    db: Session,
    ctx: MergeContext,
    content_type: ContentType,
    source_id: str,
    new_id: str,
) -> None:
    """Preserve a copied record's section origin, remapped into the new tree.

    Called *before* ``db.add()``-ing the copy itself (``new_id`` need only be
    generated first). ``app.db.session.SessionLocal`` disables autoflush, so
    ``scope_of``'s read below can't currently flush an already-pending,
    not-yet-scoped copy and let the provenance listener
    (``app.services.provenance``) stamp it with the workspace-wide default
    ahead of this function's own insert — but ordering it this way keeps that
    invariant true by construction rather than by relying on session config,
    since the two would otherwise collide as a duplicate primary key on the
    next flush.
    """
    source_scope = scope_of(db, content_type, source_id)
    section_id = (
        ctx.section_map.get(source_scope.section_id)
        if source_scope and source_scope.section_id
        else None
    )
    db.add(
        ContentScope(
            content_type=str(content_type),
            content_id=new_id,
            workspace_id=ctx.new_tree_id,
            section_id=section_id,
            created_at=utcnow_iso(),
        )
    )


def copy_sections(db: Session, ctx: MergeContext) -> None:
    """Copy sections, section membership, and per-section layout.

    Sections are deduped by normalized name across sources — mirrors the
    name-based dedup ``merge._merge_members`` already applies to members —
    since the new tree's ``(workspace_id, name_normalized)`` uniqueness
    constraint would otherwise reject a same-named section from a second
    source. Fills ``ctx.section_map`` (every source section id, including
    folded ones, maps to the section it landed on) before any content copier
    runs, since they call ``_carry_scope`` to place copied content back in
    its corresponding new section.
    """
    by_name: dict[str, str] = {}
    next_position = 0
    for t in ctx.sources:
        for s in db.scalars(
            select(Section).where(Section.workspace_id == t.id).order_by(Section.position)
        ):
            existing = by_name.get(s.name_normalized)
            if existing is not None:
                ctx.section_map[s.id] = existing
                continue
            new_id = str(uuid4())
            ctx.section_map[s.id] = new_id
            by_name[s.name_normalized] = new_id
            db.add(
                Section(
                    id=new_id,
                    workspace_id=ctx.new_tree_id,
                    name=s.name,
                    position=next_position,
                    created_at=s.created_at,
                )
            )
            next_position += 1
    db.flush()  # sections before their members/positions

    seen_members: set[tuple[str, str]] = set()
    for t in ctx.sources:
        rows = db.scalars(
            select(SectionMember)
            .join(Section, Section.id == SectionMember.section_id)
            .where(Section.workspace_id == t.id)
        )
        for sm in rows:
            sec = ctx.section_map.get(sm.section_id)
            mid = ctx.member_map.get(sm.member_id)
            if sec and mid and (sec, mid) not in seen_members:
                seen_members.add((sec, mid))
                db.add(SectionMember(section_id=sec, member_id=mid))

    seen_positions: set[tuple[str, str]] = set()
    for t in ctx.sources:
        rows = db.scalars(
            select(SectionPosition)
            .join(Section, Section.id == SectionPosition.section_id)
            .where(Section.workspace_id == t.id)
        )
        for sp in rows:
            sec = ctx.section_map.get(sp.section_id)
            mid = ctx.member_map.get(sp.member_id)
            if sec and mid and (sec, mid) not in seen_positions:
                seen_positions.add((sec, mid))
                db.add(
                    SectionPosition(
                        section_id=sec,
                        member_id=mid,
                        position_x=sp.position_x,
                        position_y=sp.position_y,
                    )
                )


def copy_saved_views(db: Session, ctx: MergeContext, owner_id: str) -> None:
    """Copy the requesting user's own saved views into the new tree.

    Only views owned by ``owner_id`` (the person doing the merge/duplicate)
    are copied. Other collaborators' saved views, like scoped grants, are
    never copied — they exist to give *other people* access or a
    configuration of their own, and a merge/duplicate result is owned
    solely by the requester until shared. Must run after ``copy_sections``
    (``section_map``) and the member merge pass (``member_map``).
    """
    for t in ctx.sources:
        views = db.scalars(
            select(SavedView).where(
                SavedView.workspace_id == t.id, SavedView.owner_id == owner_id
            )
        )
        for v in views:
            new_id = f"sv_{uuid4()}"
            focus_member_id = (
                ctx.member_map.get(v.focus_member_id) if v.focus_member_id else None
            )
            db.add(
                SavedView(
                    id=new_id,
                    workspace_id=ctx.new_tree_id,
                    owner_id=owner_id,
                    name=v.name,
                    focus_member_id=focus_member_id,
                    ancestor_depth=v.ancestor_depth,
                    descendant_depth=v.descendant_depth,
                    include_partners=v.include_partners,
                    filters=v.filters,
                    config_version=v.config_version,
                    created_at=v.created_at,
                    updated_at=v.updated_at,
                )
            )
            db.flush()  # saved view before its sections/positions

            for vs in db.scalars(
                select(SavedViewSection).where(SavedViewSection.saved_view_id == v.id)
            ):
                sec = ctx.section_map.get(vs.section_id)
                if sec:
                    db.add(
                        SavedViewSection(
                            saved_view_id=new_id,
                            section_id=sec,
                            workspace_id=ctx.new_tree_id,
                        )
                    )

            for vp in db.scalars(
                select(SavedViewPosition).where(SavedViewPosition.saved_view_id == v.id)
            ):
                # node_id is usually a member id; a synthetic match-group
                # anchor from a virtual-view conversion (#987) has no
                # counterpart here and is dropped rather than guessed at.
                mid = ctx.member_map.get(vp.node_id)
                if mid:
                    db.add(
                        SavedViewPosition(
                            saved_view_id=new_id,
                            node_id=mid,
                            position_x=vp.position_x,
                            position_y=vp.position_y,
                        )
                    )


def copy_relations(db: Session, ctx: MergeContext) -> None:
    seen: set[tuple] = set()
    for t in ctx.sources:
        for r in db.scalars(select(Relation).where(Relation.workspace_id == t.id)):
            f = ctx.member_map.get(r.from_member_id)
            to = ctx.member_map.get(r.to_member_id)
            if not f or not to:
                continue
            key = (f, to, r.relation_type)
            if key not in seen:
                seen.add(key)
                db.add(
                    Relation(
                        workspace_id=ctx.new_tree_id,
                        from_member_id=f,
                        to_member_id=to,
                        relation_type=r.relation_type,
                    )
                )


def copy_diseases(db: Session, ctx: MergeContext) -> None:
    """Copy diseases, deduped by (member, name)."""
    seen: set[tuple] = set()
    for t in ctx.sources:
        for d in db.scalars(
            select(MemberDisease).where(MemberDisease.workspace_id == t.id)
        ):
            mid = ctx.member_map.get(d.member_id)
            if mid is None:
                continue
            key = (mid, norm(d.name))
            if key in seen:
                continue
            seen.add(key)
            new_id = str(uuid4())
            _carry_scope(db, ctx, ContentType.DISEASE, d.id, new_id)
            db.add(
                MemberDisease(
                    id=new_id,
                    workspace_id=ctx.new_tree_id,
                    member_id=mid,
                    name=d.name,
                    carrier_status=d.carrier_status,
                    inheritance_pattern=d.inheritance_pattern,
                    diagnosis_date=d.diagnosis_date,
                    notes=d.notes,
                )
            )


def copy_tasks(db: Session, ctx: MergeContext) -> None:
    """Copy research tasks, deduped by (linked-member set, title).

    Fills ``ctx.task_id_map`` (every source task id, including duplicates,
    mapped to the surviving merged task id) so gallery unknown-face rows can
    follow their task into the merge.
    """
    seen: dict[tuple, str] = {}
    for t in ctx.sources:
        source_links: dict[str, list[str]] = {}
        link_rows = db.execute(
            select(MemberTaskLink)
            .join(MemberTask, MemberTask.id == MemberTaskLink.task_id)
            .where(MemberTask.workspace_id == t.id)
        ).scalars()
        for link in link_rows:
            source_links.setdefault(link.task_id, []).append(link.member_id)
        for task in db.scalars(select(MemberTask).where(MemberTask.workspace_id == t.id)):
            mapped_members = sorted(
                {
                    ctx.member_map[mid]
                    for mid in source_links.get(task.id, [])
                    if mid in ctx.member_map
                }
            )
            key = (frozenset(mapped_members), norm(task.title))
            if key in seen:
                ctx.task_id_map[task.id] = seen[key]
                continue
            new_task_id = str(uuid4())
            seen[key] = new_task_id
            ctx.task_id_map[task.id] = new_task_id
            _carry_scope(db, ctx, ContentType.TASK, task.id, new_task_id)
            db.add(
                MemberTask(
                    id=new_task_id,
                    workspace_id=ctx.new_tree_id,
                    title=task.title,
                    notes=task.notes,
                    done=task.done,
                    created_at=task.created_at,
                    done_at=task.done_at,
                )
            )
            for mid in mapped_members:
                db.add(MemberTaskLink(task_id=new_task_id, member_id=mid))


def copy_gallery(db: Session, ctx: MergeContext) -> None:
    """Copy gallery images, their member links, and unknown-face tags.

    Fills ``ctx.image_map``. Must run after ``copy_tasks`` — unknown-face
    ``task_id`` follows the task into the merge via ``ctx.task_id_map``
    (falling back to null if the task was somehow not copied), so
    resolving/deleting the face after the merge still closes the right task.
    """
    for t in ctx.sources:
        for img in db.scalars(
            select(GalleryImage).where(GalleryImage.workspace_id == t.id)
        ):
            new_id = str(uuid4())
            ctx.image_map[img.id] = new_id
            _carry_scope(db, ctx, ContentType.GALLERY_IMAGE, img.id, new_id)
            db.add(
                GalleryImage(
                    id=new_id,
                    workspace_id=ctx.new_tree_id,
                    image_data=copy_media_to_workspace(img.image_data, ctx.new_tree_id),
                    title=img.title,
                    description=img.description,
                    created_at=img.created_at,
                    uploaded_at=img.uploaded_at,
                )
            )
    db.flush()  # gallery images before their links

    seen_links: set[tuple] = set()
    for t in ctx.sources:
        links = db.scalars(
            select(GalleryMemberLink)
            .join(GalleryImage, GalleryImage.id == GalleryMemberLink.gallery_image_id)
            .where(GalleryImage.workspace_id == t.id)
        )
        for link in links:
            gi = ctx.image_map.get(link.gallery_image_id)
            mid = ctx.member_map.get(link.member_id)
            if gi and mid and (gi, mid) not in seen_links:
                seen_links.add((gi, mid))
                db.add(
                    GalleryMemberLink(
                        gallery_image_id=gi,
                        member_id=mid,
                        x=link.x,
                        y=link.y,
                        w=link.w,
                        h=link.h,
                    )
                )

    for t in ctx.sources:
        faces = db.scalars(
            select(GalleryUnknownFace)
            .join(GalleryImage, GalleryImage.id == GalleryUnknownFace.gallery_image_id)
            .where(GalleryImage.workspace_id == t.id)
        )
        for face in faces:
            gi = ctx.image_map.get(face.gallery_image_id)
            if gi:
                db.add(
                    GalleryUnknownFace(
                        id=str(uuid4()),
                        gallery_image_id=gi,
                        x=face.x,
                        y=face.y,
                        w=face.w,
                        h=face.h,
                        task_id=(
                            ctx.task_id_map.get(face.task_id) if face.task_id else None
                        ),
                        created_at=face.created_at,
                    )
                )


def copy_events(db: Session, ctx: MergeContext) -> None:
    """Copy events and their member links. Fills ``ctx.event_map``."""
    for t in ctx.sources:
        for e in db.scalars(select(Event).where(Event.workspace_id == t.id)):
            new_id = str(uuid4())
            ctx.event_map[e.id] = new_id
            _carry_scope(db, ctx, ContentType.EVENT, e.id, new_id)
            db.add(
                Event(
                    id=new_id,
                    workspace_id=ctx.new_tree_id,
                    event_type=e.event_type,
                    date=e.date,
                    location=e.location,
                    description=e.description,
                    created_at=e.created_at,
                )
            )
    db.flush()  # events before their links

    seen: set[tuple] = set()
    for t in ctx.sources:
        links = db.scalars(
            select(EventMemberLink)
            .join(Event, Event.id == EventMemberLink.event_id)
            .where(Event.workspace_id == t.id)
        )
        for link in links:
            ev = ctx.event_map.get(link.event_id)
            mid = ctx.member_map.get(link.member_id)
            if ev and mid and (ev, mid) not in seen:
                seen.add((ev, mid))
                db.add(EventMemberLink(event_id=ev, member_id=mid))


def copy_stories(db: Session, ctx: MergeContext) -> None:
    """Copy stories and their member links. Fills ``ctx.story_map``."""
    for t in ctx.sources:
        for s in db.scalars(select(Story).where(Story.workspace_id == t.id)):
            new_id = str(uuid4())
            ctx.story_map[s.id] = new_id
            _carry_scope(db, ctx, ContentType.STORY, s.id, new_id)
            db.add(
                Story(
                    id=new_id,
                    workspace_id=ctx.new_tree_id,
                    title=s.title,
                    content=s.content,
                    created_at=s.created_at,
                    updated_at=s.updated_at,
                )
            )
    db.flush()  # stories before their links

    seen: set[tuple] = set()
    for t in ctx.sources:
        links = db.scalars(
            select(StoryMemberLink)
            .join(Story, Story.id == StoryMemberLink.story_id)
            .where(Story.workspace_id == t.id)
        )
        for link in links:
            st = ctx.story_map.get(link.story_id)
            mid = ctx.member_map.get(link.member_id)
            if st and mid and (st, mid) not in seen:
                seen.add((st, mid))
                db.add(StoryMemberLink(story_id=st, member_id=mid))


def copy_documents(db: Session, ctx: MergeContext) -> None:
    """Copy documents, their files, and member/event/story links.

    Documents are reusable, tree-scoped content. Copy each source tree's
    documents (with their files) into the new tree and repoint the merged
    member/event/story links to the copies, so no link crosses a tree
    boundary. Must run after ``copy_events``/``copy_stories``. Fills
    ``ctx.document_map``.
    """
    for t in ctx.sources:
        for doc in db.scalars(select(Document).where(Document.workspace_id == t.id)):
            new_id = str(uuid4())
            ctx.document_map[doc.id] = new_id
            _carry_scope(db, ctx, ContentType.DOCUMENT, doc.id, new_id)
            db.add(
                Document(
                    id=new_id,
                    workspace_id=ctx.new_tree_id,
                    title=doc.title,
                    document_date=doc.document_date,
                    description=doc.description,
                    created_at=doc.created_at,
                    updated_at=doc.updated_at,
                )
            )
    db.flush()  # documents before their files/links

    for t in ctx.sources:
        for f in db.scalars(
            select(DocumentFile)
            .join(Document, Document.id == DocumentFile.document_id)
            .where(Document.workspace_id == t.id)
        ):
            new_doc_id = ctx.document_map.get(f.document_id)
            if new_doc_id is None:
                continue
            new_url = f.url
            if f.kind == "file":
                new_url = copy_media_to_workspace(f.url, ctx.new_tree_id) or f.url
            db.add(
                DocumentFile(
                    id=str(uuid4()),
                    workspace_id=ctx.new_tree_id,
                    document_id=new_doc_id,
                    kind=f.kind,
                    filename=f.filename,
                    url=new_url,
                    mime_type=f.mime_type,
                    size=f.size,
                    created_at=f.created_at,
                )
            )

    seen_member: set[tuple] = set()
    for t in ctx.sources:
        for link in db.scalars(
            select(DocumentMemberLink)
            .join(Document, Document.id == DocumentMemberLink.document_id)
            .where(Document.workspace_id == t.id)
        ):
            nd = ctx.document_map.get(link.document_id)
            mid = ctx.member_map.get(link.member_id)
            if nd and mid and (nd, mid) not in seen_member:
                seen_member.add((nd, mid))
                db.add(DocumentMemberLink(document_id=nd, member_id=mid))

    seen_event: set[tuple] = set()
    for t in ctx.sources:
        for link in db.scalars(
            select(EventDocumentLink)
            .join(Document, Document.id == EventDocumentLink.document_id)
            .where(Document.workspace_id == t.id)
        ):
            ev = ctx.event_map.get(link.event_id)
            nd = ctx.document_map.get(link.document_id)
            if ev and nd and (ev, nd) not in seen_event:
                seen_event.add((ev, nd))
                db.add(EventDocumentLink(event_id=ev, document_id=nd))

    seen_story: set[tuple] = set()
    for t in ctx.sources:
        for link in db.scalars(
            select(StoryDocumentLink)
            .join(Document, Document.id == StoryDocumentLink.document_id)
            .where(Document.workspace_id == t.id)
        ):
            st = ctx.story_map.get(link.story_id)
            nd = ctx.document_map.get(link.document_id)
            if st and nd and (st, nd) not in seen_story:
                seen_story.add((st, nd))
                db.add(StoryDocumentLink(story_id=st, document_id=nd))
