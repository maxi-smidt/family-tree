"""Sub-tree extraction service.

Moves a connected branch of an existing tree into a brand-new tree, keeping
member ids. The root stays behind in the source tree as the bridge person
(tree-in-tree link) with a fresh counterpart seeded in the new tree, and
relations crossing the cut elsewhere are severed.

The branch is selected by picking a root member and one of three
``direction`` values:

- ``descendants`` / ``ancestors``: traverse parent-edges from the root, up to
  an optional depth, then (optionally) pull in one hop of partners.
- ``whole_family`` (default): a two-sided selection that pulls in "everyone
  attached to the root who isn't part of the root's own family" — see
  ``_collect_whole_family_ids`` for the exact algorithm. ``depth`` and
  ``include_partners`` do not apply to this mode.
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
from app.services import feature_service
from app.services.activity import record_activity
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_tree_event
from app.services.job_service import ProgressCallback
from app.services.merge import _clone_member
from app.services.storage import media_disk_usage, move_media_to_tree


def _require_readable(db: Session, user: User, tree_id: str) -> Tree:
    tree = db.get(Tree, tree_id)
    if tree is None or role_for(db, tree, user) is None:
        raise HTTPException(status_code=404, detail="Source tree not found")
    return tree


def _bfs(
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


def _collect_member_ids(
    db: Session,
    tree_id: str,
    root_id: str,
    direction: str,
    depth: int | None,
    include_partners: bool,
) -> set[str]:
    """Return the set of member ids that belong in the sub-tree.

    ``direction == "whole_family"`` ignores ``depth``/``include_partners``
    and delegates to ``_collect_whole_family_ids``.
    """
    # Validate root exists in this tree.
    root = db.scalar(
        select(Member).where(Member.tree_id == tree_id, Member.id == root_id)
    )
    if root is None:
        raise HTTPException(status_code=404, detail="Root member not found in tree")

    if direction == "whole_family":
        return _collect_whole_family_ids(db, tree_id, root_id)

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

    if direction == "descendants":
        core = _bfs(root_id, children_of, depth)
    else:  # ancestors
        core = _bfs(root_id, parents_of, depth)

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


def _collect_whole_family_ids(db: Session, tree_id: str, root_id: str) -> set[str]:
    """"Whole family" selection: everyone attached to the root who isn't part
    of the root's own ("staying") family.

    Built over an undirected adjacency graph of ALL relations in the tree
    (parent relations connect child<->parent; every other relation type -
    partner, married, divorced, ... - connects its two endpoints):

    1. Anchors = the root's partners (members sharing a non-parent relation
       with the root) and the root's children (parent relations where the
       root is the parent). NOT the root's own parents.
    2. Staying set = everyone reachable from the anchors; moved set =
       everyone reachable from the root. Both are grown breadth-first in
       lockstep (one layer at a time, racing each other) so that a node is
       claimed by whichever side reaches it first. This matters for cycles
       that loop back through a marriage — e.g. the root's sister also
       marries into the main family: the sister's husband is topologically
       closer to the anchors (stays) while the sister herself is closer to
       the root (moves), even though they're linked by a partner relation.
       The root never joins staying and always seeds moved.
    3. The root itself is excluded from the returned set (it is the bridge
       and stays in both trees).
    """
    relations = list(
        db.scalars(select(Relation).where(Relation.tree_id == tree_id))
    )

    adjacency: dict[str, set[str]] = {}

    def link(a: str, b: str) -> None:
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)

    anchors: set[str] = set()
    for r in relations:
        link(r.from_member_id, r.to_member_id)
        if r.relation_type == "parent":
            # from = child, to = parent. Root's children: root is the parent.
            if r.to_member_id == root_id:
                anchors.add(r.from_member_id)
        else:
            # Peer relation (partner/married/divorced/...): both endpoints
            # are anchors if either is the root.
            if r.from_member_id == root_id:
                anchors.add(r.to_member_id)
            elif r.to_member_id == root_id:
                anchors.add(r.from_member_id)

    # Expand the "staying" (from anchors) and "moved" (from root) frontiers
    # in lockstep, one BFS layer at a time, each claiming unclaimed nodes as
    # it reaches them. A plain sequential BFS (all of staying first, then
    # moved) would leak through marriage cycles that loop back into the
    # root's own family (e.g. root's sister marries into the main family: a
    # sequential staying-BFS would walk anchor -> ... -> sister's husband ->
    # sister -> root's own parents and swallow the whole moved side).
    # Racing the two frontiers layer-by-layer means whichever side is
    # topologically closer wins each node, matching the intuitive "which
    # family is this person closer to" split.
    staying: set[str] = set(anchors)
    moved: set[str] = {root_id}
    claimed: set[str] = set(anchors) | {root_id}
    staying_frontier: deque[str] = deque(anchors)
    moved_frontier: deque[str] = deque([root_id])
    while staying_frontier or moved_frontier:
        for _ in range(len(staying_frontier)):
            node = staying_frontier.popleft()
            for nb in adjacency.get(node, ()):
                if nb in claimed:
                    continue
                claimed.add(nb)
                staying.add(nb)
                staying_frontier.append(nb)
        for _ in range(len(moved_frontier)):
            node = moved_frontier.popleft()
            for nb in adjacency.get(node, ()):
                if nb in claimed:
                    continue
                claimed.add(nb)
                moved.add(nb)
                moved_frontier.append(nb)

    return moved


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
    if req.direction not in ("whole_family", "descendants", "ancestors"):
        raise HTTPException(
            status_code=400,
            detail=(
                "direction must be 'whole_family', 'descendants' or 'ancestors'"
            ),
        )
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


def compute_subtree_preview(
    db: Session,
    user: User,
    req: SubtreeExtractRequest,
) -> SubtreePreview:
    """Preview an extraction without writing anything (same checks as the move)."""
    tree, root = validate_move_request(db, user, req)
    member_ids = _collect_member_ids(
        db, tree.id, root.id, req.direction, req.depth, req.include_partners
    )
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
        gallery_links, _event_links, story_links = _load_member_links(db, tree.id)
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
        moved_story_ids, _ = _split_linked_entities(story_links, "story_id", moved)
        if moved_story_ids:
            for url in db.scalars(
                select(StoryAttachment.url).where(
                    StoryAttachment.tree_id == tree.id,
                    StoryAttachment.story_id.in_(moved_story_ids),
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
    member_ids = _collect_member_ids(
        db, tree.id, root.id, req.direction, req.depth, req.include_partners
    )
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
    counterpart.linked_tree_id = tree.id
    counterpart.linked_member_id = root.id
    db.add(counterpart)
    db.flush()

    root.linked_tree_id = new_tree.id
    root.linked_member_id = counterpart.id
    # The branch is gone; the linked-tree badge replaces the collapse chip.
    root.is_collapsed = False
    _progress(25)

    # --- Members: keep ids, re-point the tree, relocate photos on disk ---
    for m in db.scalars(
        select(Member).where(Member.tree_id == tree.id, Member.id.in_(moved))
    ):
        m.tree_id = new_tree.id
        m.image_data = move_media_to_tree(m.image_data, new_tree.id)
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
        for att in db.scalars(
            select(StoryAttachment).where(
                StoryAttachment.tree_id == tree.id,
                StoryAttachment.story_id.in_(moved_story_ids),
            )
        ):
            att.tree_id = new_tree.id
            new_url = move_media_to_tree(att.url, new_tree.id)
            if new_url is not None:
                att.url = new_url
    for lnk in stale_story_links:
        db.delete(lnk)
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
