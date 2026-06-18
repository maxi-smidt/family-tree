"""Sub-tree extraction service.

Creates a new independent tree from a connected subset of an existing tree,
selected by picking a root member and traversal direction (descendants /
ancestors / both) with an optional depth limit.  The source tree is never
modified.
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
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Member,
    MemberDisease,
    Relation,
    Story,
    StoryAttachment,
    StoryMemberLink,
    Tree,
    User,
)
from app.schemas.extract import SubtreeExtractRequest, SubtreePreview
from app.services.merge import _clone_member
from app.services.storage import copy_media_to_tree


def _require_readable(db: Session, user: User, tree_id: str) -> Tree:
    tree = db.get(Tree, tree_id)
    if tree is None or role_for(db, tree, user) is None:
        raise HTTPException(status_code=404, detail="Source tree not found")
    return tree


def _collect_member_ids(
    db: Session,
    tree_id: str,
    root_id: str,
    direction: str,
    depth: int | None,
    include_partners: bool,
) -> set[str]:
    """Return the set of member ids that belong in the sub-tree."""
    # Validate root exists in this tree.
    root = db.scalar(
        select(Member).where(Member.tree_id == tree_id, Member.id == root_id)
    )
    if root is None:
        raise HTTPException(status_code=404, detail="Root member not found in tree")

    # Build parent-edge adjacency from Relation rows.
    # A "parent" relation is stored as: from=child, to=parent.
    parent_rows = list(
        db.scalars(
            select(Relation).where(
                Relation.tree_id == tree_id,
                Relation.relation_type == "parent",
            )
        )
    )
    parents_of: dict[str, list[str]] = {}   # child_id -> [parent_id, ...]
    children_of: dict[str, list[str]] = {}  # parent_id -> [child_id, ...]
    for r in parent_rows:
        parents_of.setdefault(r.from_member_id, []).append(r.to_member_id)
        children_of.setdefault(r.to_member_id, []).append(r.from_member_id)

    def bfs(
        start: str, neighbours: dict[str, list[str]], max_depth: int | None
    ) -> set[str]:
        visited: set[str] = {start}
        queue: deque[tuple[str, int]] = deque([(start, 0)])
        while queue:
            node, d = queue.popleft()
            if max_depth is not None and d >= max_depth:
                continue
            for nb in neighbours.get(node, []):
                if nb not in visited:
                    visited.add(nb)
                    queue.append((nb, d + 1))
        return visited

    core: set[str]
    if direction == "descendants":
        core = bfs(root_id, children_of, depth)
    elif direction == "ancestors":
        core = bfs(root_id, parents_of, depth)
    else:  # both
        core = bfs(root_id, children_of, depth) | bfs(root_id, parents_of, depth)

    if include_partners:
        # Load all non-parent relations; add peers (partner/married/divorced) of
        # every core member — one hop, no further traversal.
        peer_rows = list(
            db.scalars(
                select(Relation).where(
                    Relation.tree_id == tree_id,
                    Relation.relation_type != "parent",
                )
            )
        )
        peers: set[str] = set()
        for r in peer_rows:
            if r.from_member_id in core:
                peers.add(r.to_member_id)
            if r.to_member_id in core:
                peers.add(r.from_member_id)
        # Only add peers that actually exist in the source tree.
        existing_ids = set(
            db.scalars(select(Member.id).where(Member.tree_id == tree_id))
        )
        core |= peers & existing_ids

    return core


def compute_subtree_preview(
    db: Session,
    user: User,
    req: SubtreeExtractRequest,
) -> SubtreePreview:
    """Compute a preview without writing anything."""
    _require_readable(db, user, req.source_tree_id)
    member_ids = _collect_member_ids(
        db,
        req.source_tree_id,
        req.root_member_id,
        req.direction,
        req.depth,
        req.include_partners,
    )
    relations = list(
        db.scalars(select(Relation).where(Relation.tree_id == req.source_tree_id))
    )
    relation_count = sum(
        1
        for r in relations
        if r.from_member_id in member_ids and r.to_member_id in member_ids
    )
    return SubtreePreview(member_count=len(member_ids), relation_count=relation_count)


def extract_subtree(
    db: Session,
    user: User,
    req: SubtreeExtractRequest,
) -> Tree:
    _require_readable(db, user, req.source_tree_id)
    member_ids = _collect_member_ids(
        db,
        req.source_tree_id,
        req.root_member_id,
        req.direction,
        req.depth,
        req.include_partners,
    )

    new_tree = Tree(
        id=str(uuid4()),
        name=req.name,
        owner_id=user.id,
        created_at=utcnow_iso(),
        last_opened=utcnow_iso(),
    )
    db.add(new_tree)
    db.flush()

    # --- Members ---
    member_map: dict[str, str] = {}
    source_members = list(
        db.scalars(
            select(Member).where(
                Member.tree_id == req.source_tree_id,
                Member.id.in_(member_ids),
            )
        )
    )
    for m in source_members:
        new_id = str(uuid4())
        member_map[m.id] = new_id
        db.add(_clone_member(m, new_tree.id, new_id))
    db.flush()

    # --- Relations ---
    seen_relations: set[tuple] = set()
    for r in db.scalars(
        select(Relation).where(Relation.tree_id == req.source_tree_id)
    ):
        f = member_map.get(r.from_member_id)
        to = member_map.get(r.to_member_id)
        if not f or not to:
            continue
        key = (f, to, r.relation_type)
        if key not in seen_relations:
            seen_relations.add(key)
            db.add(
                Relation(
                    tree_id=new_tree.id,
                    from_member_id=f,
                    to_member_id=to,
                    relation_type=r.relation_type,
                )
            )

    # --- Diseases ---
    seen_diseases: set[tuple] = set()
    for d in db.scalars(
        select(MemberDisease).where(MemberDisease.tree_id == req.source_tree_id)
    ):
        mid = member_map.get(d.member_id)
        if mid is None:
            continue
        key = (mid, (d.name or "").strip().lower())
        if key in seen_diseases:
            continue
        seen_diseases.add(key)
        db.add(
            MemberDisease(
                id=str(uuid4()),
                tree_id=new_tree.id,
                member_id=mid,
                name=d.name,
                carrier_status=d.carrier_status,
                inheritance_pattern=d.inheritance_pattern,
                diagnosis_date=d.diagnosis_date,
                notes=d.notes,
            )
        )

    # --- Gallery images + links ---
    # Only include images that have at least one link to an included member.
    all_gallery_links = list(
        db.scalars(
            select(GalleryMemberLink)
            .join(GalleryImage, GalleryImage.id == GalleryMemberLink.gallery_image_id)
            .where(GalleryImage.tree_id == req.source_tree_id)
        )
    )
    # Which image ids have at least one link to a selected member?
    included_image_ids: set[str] = {
        lnk.gallery_image_id
        for lnk in all_gallery_links
        if lnk.member_id in member_ids
    }
    image_map: dict[str, str] = {}
    for img in db.scalars(
        select(GalleryImage).where(
            GalleryImage.tree_id == req.source_tree_id,
            GalleryImage.id.in_(included_image_ids),
        )
    ):
        new_id = str(uuid4())
        image_map[img.id] = new_id
        db.add(
            GalleryImage(
                id=new_id,
                tree_id=new_tree.id,
                image_data=copy_media_to_tree(img.image_data, new_tree.id),
                title=img.title,
                description=img.description,
                created_at=img.created_at,
                uploaded_at=img.uploaded_at,
            )
        )
    db.flush()
    seen_gallery_links: set[tuple] = set()
    for lnk in all_gallery_links:
        gi = image_map.get(lnk.gallery_image_id)
        mid = member_map.get(lnk.member_id)
        if gi and mid and (gi, mid) not in seen_gallery_links:
            seen_gallery_links.add((gi, mid))
            db.add(GalleryMemberLink(gallery_image_id=gi, member_id=mid))

    # --- Events + links ---
    all_event_links = list(
        db.scalars(
            select(EventMemberLink)
            .join(Event, Event.id == EventMemberLink.event_id)
            .where(Event.tree_id == req.source_tree_id)
        )
    )
    included_event_ids: set[str] = {
        lnk.event_id for lnk in all_event_links if lnk.member_id in member_ids
    }
    event_map: dict[str, str] = {}
    for e in db.scalars(
        select(Event).where(
            Event.tree_id == req.source_tree_id,
            Event.id.in_(included_event_ids),
        )
    ):
        new_id = str(uuid4())
        event_map[e.id] = new_id
        db.add(
            Event(
                id=new_id,
                tree_id=new_tree.id,
                event_type=e.event_type,
                date=e.date,
                location=e.location,
                description=e.description,
                created_at=e.created_at,
            )
        )
    db.flush()
    seen_event_links: set[tuple] = set()
    for lnk in all_event_links:
        ev = event_map.get(lnk.event_id)
        mid = member_map.get(lnk.member_id)
        if ev and mid and (ev, mid) not in seen_event_links:
            seen_event_links.add((ev, mid))
            db.add(EventMemberLink(event_id=ev, member_id=mid))

    # --- Stories + links + attachments ---
    all_story_links = list(
        db.scalars(
            select(StoryMemberLink)
            .join(Story, Story.id == StoryMemberLink.story_id)
            .where(Story.tree_id == req.source_tree_id)
        )
    )
    included_story_ids: set[str] = {
        lnk.story_id for lnk in all_story_links if lnk.member_id in member_ids
    }
    story_map: dict[str, str] = {}
    for s in db.scalars(
        select(Story).where(
            Story.tree_id == req.source_tree_id,
            Story.id.in_(included_story_ids),
        )
    ):
        new_id = str(uuid4())
        story_map[s.id] = new_id
        db.add(
            Story(
                id=new_id,
                tree_id=new_tree.id,
                title=s.title,
                content=s.content,
                created_at=s.created_at,
                updated_at=s.updated_at,
            )
        )
    db.flush()
    seen_story_links: set[tuple] = set()
    for lnk in all_story_links:
        st = story_map.get(lnk.story_id)
        mid = member_map.get(lnk.member_id)
        if st and mid and (st, mid) not in seen_story_links:
            seen_story_links.add((st, mid))
            db.add(StoryMemberLink(story_id=st, member_id=mid))

    for att in db.scalars(
        select(StoryAttachment).where(StoryAttachment.tree_id == req.source_tree_id)
    ):
        st = story_map.get(att.story_id)
        new_url = copy_media_to_tree(att.url, new_tree.id)
        if st is None or new_url is None:
            continue
        db.add(
            StoryAttachment(
                id=str(uuid4()),
                tree_id=new_tree.id,
                story_id=st,
                filename=att.filename,
                url=new_url,
                mime_type=att.mime_type,
                size=att.size,
                created_at=att.created_at,
            )
        )

    db.commit()
    db.refresh(new_tree)
    return new_tree
