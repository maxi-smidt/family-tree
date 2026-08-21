"""Server-side tree merge.

Combines one or two source trees into a brand-new tree owned by the requesting
user. Members are de-duplicated by (first name, last name, gender, birth, death)
— matching the old client-side merge — and notes from duplicates are combined.
All ids are regenerated (ids are globally unique here), relations/links are
remapped, and member photos / gallery media are copied into the new tree.

New in #166: ``compute_merge_preview`` for a preview endpoint, and optional
per-pair ``resolutions`` that let callers override merge vs keep_both and
choose field values on a conflict.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
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
    MemberTaskLink,
    Relation,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    Tree,
    User,
)
from app.schemas.family import MemberOut
from app.schemas.merge import (
    DuplicatePair,
    FieldChoice,
    MergeResolution,
    TreeMergePreview,
)
from app.services.activity import record_activity
from app.services.event_bus import publish_tree_event
from app.services.job_service import ProgressCallback
from app.services.storage import copy_media_to_tree
from app.services.tree_state import mark_tree_opened

if TYPE_CHECKING:
    pass


MemberIdMap = dict[str, str]


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

def norm(value: str | None) -> str:
    return (value or "").strip().lower()


def _empty(value: str | None) -> bool:
    """True when the value should be treated as absent (None or blank)."""
    return not (value or "").strip()


_CAMEL_BOUNDARY = re.compile(r"(?<!^)(?=[A-Z])")


def to_snake_case(name: str) -> str:
    """Convert a camelCase field name (as the frontend sends field_choices /
    merge resolution keys) to the snake_case attribute name used on
    ``Member``. Already-snake_case input passes through unchanged."""
    return _CAMEL_BOUNDARY.sub("_", name).lower()


def member_key(m: Member) -> tuple:
    """Exact-duplicate key: name + gender + both dates (all normalised)."""
    return (
        norm(m.first_name), norm(m.last_name),
        m.gender, m.date_of_birth, m.date_of_death,
    )


def member_name_key(m: Member) -> tuple:
    """Name + gender only — used for possible-candidate detection."""
    return (norm(m.first_name), norm(m.last_name), m.gender)


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------

def _require_readable(db: Session, user: User, tree_id: str) -> Tree:
    tree = db.get(Tree, tree_id)
    if tree is None or role_for(db, tree, user) is None:
        raise HTTPException(status_code=404, detail="Source tree not found")
    return tree


# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------

CONFLICT_FIELDS: list[str] = [
    "middle_names",
    "baptismal_name",
    "maiden_name",
    "birthplace",
    "hometown",
    "cemetery",
    "places_lived",
    "additional_data",
    "image_data",
    "date_of_birth",
    "date_of_death",
]


def compute_conflicts(a: Member, b: Member) -> list[str]:
    """Return field names where the two members differ in a meaningful way.

    A field where only one side has a value is still reported (not just
    both-set-and-differing) — otherwise a lone value on the non-default side
    is never surfaced as a choice and gets silently dropped by whichever
    caller applies an all-empty default (#812).
    """
    conflicts: list[str] = []
    for field in CONFLICT_FIELDS:
        va = getattr(a, field, None)
        vb = getattr(b, field, None)
        # Treat None and "" as equal-empty
        if _empty(va) and _empty(vb):
            continue
        if (va or "") != (vb or ""):
            conflicts.append(field)
    return conflicts


# ---------------------------------------------------------------------------
# Preview computation
# ---------------------------------------------------------------------------

def compute_merge_preview(
    db: Session,
    user: User,
    source_a_id: str,
    source_b_id: str | None,
) -> TreeMergePreview:
    """Compute a merge preview without touching the database."""
    tree_a = _require_readable(db, user, source_a_id)
    tree_b = _require_readable(db, user, source_b_id) if source_b_id else None

    members_a: list[Member] = list(
        db.scalars(select(Member).where(Member.tree_id == tree_a.id))
    )
    members_b: list[Member] = (
        list(db.scalars(select(Member).where(Member.tree_id == tree_b.id)))
        if tree_b
        else []
    )

    total_members = len(members_a) + len(members_b)

    if not members_b:
        # Single-source copy: no duplicates possible
        return TreeMergePreview(
            total_members=total_members,
            merged_count=total_members,
            duplicates=[],
        )

    # Index source-A members by exact key and by name key
    exact_by_key: dict[tuple, Member] = {}
    name_by_key: dict[tuple, Member] = {}
    for m in members_a:
        exact_by_key[member_key(m)] = m
        name_by_key[member_name_key(m)] = m

    duplicates: list[DuplicatePair] = []
    exact_matched_b_ids: set[str] = set()
    possible_matched_b_ids: set[str] = set()

    # First pass: exact duplicates
    for mb in members_b:
        exact_key = member_key(mb)
        if exact_key in exact_by_key:
            ma = exact_by_key[exact_key]
            conflicts = compute_conflicts(ma, mb)
            duplicates.append(
                DuplicatePair(
                    member_a=MemberOut.model_validate(ma),
                    member_b=MemberOut.model_validate(mb),
                    match="exact",
                    conflicts=conflicts,
                    default_action="merge",
                )
            )
            exact_matched_b_ids.add(mb.id)

    # Second pass: possible candidates (name+gender match, but dates differ)
    for mb in members_b:
        if mb.id in exact_matched_b_ids:
            continue
        name_key = member_name_key(mb)
        if name_key in name_by_key:
            ma = name_by_key[name_key]
            # Sanity check: must not be an exact match (already handled above)
            if member_key(ma) == member_key(mb):
                continue
            conflicts = compute_conflicts(ma, mb)
            duplicates.append(
                DuplicatePair(
                    member_a=MemberOut.model_validate(ma),
                    member_b=MemberOut.model_validate(mb),
                    match="possible",
                    conflicts=conflicts,
                    default_action="keep_both",
                )
            )
            possible_matched_b_ids.add(mb.id)

    # merged_count = how many rows the result tree would have (under defaults)
    # Exact dupes → 1 row; possible → 2 rows (default keep_both)
    merged_count = total_members - len(exact_matched_b_ids)

    return TreeMergePreview(
        total_members=total_members,
        merged_count=merged_count,
        duplicates=duplicates,
    )


# ---------------------------------------------------------------------------
# Clone helpers
# ---------------------------------------------------------------------------

def _clone_member(m: Member, new_tree_id: str, new_id: str) -> Member:
    return Member(
        id=new_id,
        tree_id=new_tree_id,
        gender=m.gender,
        academic_title=m.academic_title,
        deceased=m.deceased,
        adopted=m.adopted,
        first_name=m.first_name,
        middle_names=m.middle_names,
        baptismal_name=m.baptismal_name,
        last_name=m.last_name,
        maiden_name=m.maiden_name,
        image_data=copy_media_to_tree(m.image_data, new_tree_id),
        date_of_birth=m.date_of_birth,
        date_of_death=m.date_of_death,
        additional_data=m.additional_data,
        is_collapsed=m.is_collapsed,
        position_x=m.position_x,
        position_y=m.position_y,
        birthplace=m.birthplace,
        hometown=m.hometown,
        cemetery=m.cemetery,
        places_lived=m.places_lived,
    )


def _wire_bridge(source: Member, counterpart: Member) -> None:
    """Point two member rows at each other as a bridge person pair.

    Shared by every flow that establishes a tree-in-tree link (create-linked-
    subtree, extract-subtree, and the link-existing-tree endpoint) so the
    bidirectional wiring stays in one place.
    """
    source.linked_tree_id = counterpart.tree_id
    source.linked_member_id = counterpart.id
    counterpart.linked_tree_id = source.tree_id
    counterpart.linked_member_id = source.id


def apply_field_choices(
    clone: Member,
    ma: Member,
    mb: Member,
    fields: dict[str, FieldChoice],
) -> None:
    """Apply per-field resolution choices to a merged clone.

    ``clone`` was already built from ``ma`` (source A); we apply overrides here.
    ``fields`` maps field_name → "a" | "b" | "combine".
    """
    text_fields = {"additional_data", "places_lived"}
    for field, choice in fields.items():
        if field not in CONFLICT_FIELDS:
            continue
        va = getattr(ma, field, None)
        vb = getattr(mb, field, None)
        if choice == "a":
            setattr(clone, field, va)
        elif choice == "b":
            setattr(clone, field, vb)
        elif choice == "combine" and field in text_fields:
            separator = "\n\n" if field == "additional_data" else ", "
            parts = [p for p in [va, vb] if not _empty(p)]
            # Deduplicate while preserving order
            seen: list[str] = []
            for p in parts:
                if p not in seen:
                    seen.append(p)
            setattr(clone, field, separator.join(seen) if seen else None)


def reconcile_bridge_fields(
    member: Member,
    counterpart: Member,
    choices: dict[str, FieldChoice] | None = None,
) -> None:
    """Reconcile the conflicting fields of a freshly-wired bridge pair.

    Used by the link-existing-tree flow (mode="existing") right after
    ``_wire_bridge``: the two rows represent the same human, so once linked
    their conflicting fields (dates, places, images, notes, ...) should agree
    on both sides, not just drift until a later edit or bridge-sync.

    For each field in ``CONFLICT_FIELDS`` an explicit choice ("a" | "b" |
    "combine", a = ``member``, b = ``counterpart``) from ``choices`` is
    applied when given; otherwise the fields are unioned (whichever side is
    non-empty wins, preferring ``member`` when both are set) via the same
    a/b/combine semantics as ``apply_field_choices``. ``image_data`` is copied
    into the destination tree's media store, mirroring
    ``bridge.copy_bridge_fields``.

    ``choices`` keys may be camelCase (as sent by the frontend, matching its
    ``RESOLVABLE_FIELDS``) or snake_case; both are normalised to the
    ``Member`` attribute name.
    """
    choices = choices or {}
    normalised_choices = {to_snake_case(k): v for k, v in choices.items()}
    resolved: dict[str, FieldChoice] = {
        k: v for k, v in normalised_choices.items() if k in CONFLICT_FIELDS
    }
    for field in CONFLICT_FIELDS:
        if field in resolved:
            continue
        va = getattr(member, field, None)
        vb = getattr(counterpart, field, None)
        # Union default: prefer whichever side is non-empty; when both are
        # set (a genuine conflict with no explicit choice) keep A's value.
        resolved[field] = "a" if not _empty(va) or _empty(vb) else "b"

    # Snapshot pre-reconciliation values so both a→b and b→a copies read the
    # same source data even though `member` is mutated first below.
    orig_member = {f: getattr(member, f, None) for f in CONFLICT_FIELDS}
    orig_counterpart = {f: getattr(counterpart, f, None) for f in CONFLICT_FIELDS}

    for field, choice in resolved.items():
        if choice == "a":
            value = orig_member[field]
        elif choice == "b":
            value = orig_counterpart[field]
        else:  # combine
            if field in {"additional_data", "places_lived"}:
                separator = "\n\n" if field == "additional_data" else ", "
                parts = [
                    p for p in [orig_member[field], orig_counterpart[field]]
                    if not _empty(p)
                ]
                seen: list[str] = []
                for p in parts:
                    if p not in seen:
                        seen.append(p)
                value = separator.join(seen) if seen else None
            else:
                # Combine doesn't apply to non-text fields; fall back to A.
                value = orig_member[field]

        if field == "image_data":
            member.image_data = (
                value if value == orig_member["image_data"]
                else copy_media_to_tree(value, member.tree_id)
            )
            counterpart.image_data = (
                value if value == orig_counterpart["image_data"]
                else copy_media_to_tree(value, counterpart.tree_id)
            )
        else:
            setattr(member, field, value)
            setattr(counterpart, field, value)


# ---------------------------------------------------------------------------
# Resolution index helpers
# ---------------------------------------------------------------------------

def _build_resolution_index(
    resolutions: list[MergeResolution] | None,
) -> dict[frozenset, MergeResolution]:
    """Map {frozenset({id_a, id_b})} → resolution for O(1) lookup."""
    if not resolutions:
        return {}
    return {frozenset({r.member_a_id, r.member_b_id}): r for r in resolutions}


# ---------------------------------------------------------------------------
# Main merge entry point
# ---------------------------------------------------------------------------

def merge_trees(
    db: Session,
    user: User,
    name: str,
    source_a_id: str,
    source_b_id: str | None,
    resolutions: list[MergeResolution] | None = None,
    progress_cb: ProgressCallback | None = None,
) -> Tree:
    def _progress(pct: int) -> None:
        if progress_cb is not None:
            progress_cb(pct)

    tree_a = _require_readable(db, user, source_a_id)
    tree_b = _require_readable(db, user, source_b_id) if source_b_id else None
    sources = [t for t in (tree_a, tree_b) if t is not None]

    res_index = _build_resolution_index(resolutions)

    new_tree = Tree(
        id=str(uuid4()),
        name=name,
        owner_id=user.id,
        created_at=utcnow_iso(),
    )
    db.add(new_tree)
    db.flush()
    mark_tree_opened(db, new_tree.id, user.id)
    _progress(10)

    # --- Members (with de-duplication across both sources) -----------------
    # member_map: source member id → new tree member id
    member_map: MemberIdMap = {}
    # dedup: exact-match key → clone Member object (so we can apply field merges)
    dedup: dict[tuple, Member] = {}
    # name-key index for possible-candidate detection
    name_index: dict[tuple, tuple[Member, str]] = {}  # name_key → (clone, original_a_id)

    # Collect all members from source A first
    members_a = list(db.scalars(select(Member).where(Member.tree_id == tree_a.id)))
    members_b = (
        list(db.scalars(select(Member).where(Member.tree_id == tree_b.id)))
        if tree_b
        else []
    )

    # ---- Pass 1: clone all source-A members ----
    for ma in members_a:
        new_id = str(uuid4())
        member_map[ma.id] = new_id
        clone = _clone_member(ma, new_tree.id, new_id)
        db.add(clone)
        dedup[member_key(ma)] = clone
        name_index[member_name_key(ma)] = (clone, ma.id)

    # ---- Pass 2: process source-B members ----
    for mb in members_b:
        exact_key = member_key(mb)
        name_key = member_name_key(mb)

        # --- Check resolution for this pair (if any) ---
        # We need to find the matching source-A member to look up the resolution.
        matched_a_clone: Member | None = dedup.get(exact_key)
        matched_a_id: str | None = None
        match_type: str | None = None

        if matched_a_clone is not None:
            # Exact match found
            # Find the original A member id from the member_map (reverse lookup)
            for orig_id, new_id in member_map.items():
                if new_id == matched_a_clone.id:
                    matched_a_id = orig_id
                    break
            match_type = "exact"
        elif name_key in name_index:
            # Possible candidate (name+gender match, dates differ)
            matched_a_clone, matched_a_id = name_index[name_key]
            match_type = "possible"

        if matched_a_id is not None and matched_a_clone is not None:
            res_key = frozenset({matched_a_id, mb.id})
            resolution = res_index.get(res_key)

            if match_type == "exact":
                # Default behaviour: merge (unless keep_both resolution)
                action = resolution.action if resolution else "merge"
            else:
                # Possible candidate: default keep_both (unless merge resolution)
                action = resolution.action if resolution else "keep_both"

            if action == "keep_both":
                # Clone B as a separate member
                new_id = str(uuid4())
                member_map[mb.id] = new_id
                clone_b = _clone_member(mb, new_tree.id, new_id)
                db.add(clone_b)
            else:
                # Merge: B maps to A's clone; apply field choices if given
                member_map[mb.id] = matched_a_clone.id
                if resolution and resolution.fields:
                    # Find the original A member for field comparison
                    orig_ma = next(
                        (m for m in members_a if m.id == matched_a_id), None
                    )
                    if orig_ma is not None:
                        apply_field_choices(
                            matched_a_clone, orig_ma, mb, resolution.fields
                        )
                else:
                    # Legacy behaviour: combine additional_data
                    if (
                        mb.additional_data
                        and mb.additional_data != matched_a_clone.additional_data
                    ):
                        matched_a_clone.additional_data = (
                            f"{matched_a_clone.additional_data}\n\n{mb.additional_data}"
                            if matched_a_clone.additional_data
                            else mb.additional_data
                        )
        else:
            # No match: always clone as new
            new_id = str(uuid4())
            member_map[mb.id] = new_id
            clone = _clone_member(mb, new_tree.id, new_id)
            db.add(clone)

    # Members must exist before relations/diseases/links reference them.
    db.flush()
    _progress(50)

    # --- Relations ---------------------------------------------------------
    seen_relations: set[tuple] = set()
    for t in sources:
        for r in db.scalars(select(Relation).where(Relation.tree_id == t.id)):
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

    # --- Diseases (deduped by member + name) -------------------------------
    seen_diseases: set[tuple] = set()
    for t in sources:
        for d in db.scalars(select(MemberDisease).where(MemberDisease.tree_id == t.id)):
            mid = member_map.get(d.member_id)
            if mid is None:
                continue
            key = (mid, norm(d.name))
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

    # --- Research tasks (deduped by linked-member set + title) --------------
    # seen_tasks maps the dedup key to the surviving merged task id, and
    # task_id_map maps every source task id to it, so rows referencing tasks
    # (gallery unknown faces below) can follow their task into the merge.
    seen_tasks: dict[tuple, str] = {}
    task_id_map: MemberIdMap = {}
    for t in sources:
        source_links: dict[str, list[str]] = {}
        link_rows = db.execute(
            select(MemberTaskLink)
            .join(MemberTask, MemberTask.id == MemberTaskLink.task_id)
            .where(MemberTask.tree_id == t.id)
        ).scalars()
        for link in link_rows:
            source_links.setdefault(link.task_id, []).append(link.member_id)
        for task in db.scalars(select(MemberTask).where(MemberTask.tree_id == t.id)):
            mapped_members = sorted(
                {
                    member_map[mid]
                    for mid in source_links.get(task.id, [])
                    if mid in member_map
                }
            )
            key = (frozenset(mapped_members), norm(task.title))
            if key in seen_tasks:
                task_id_map[task.id] = seen_tasks[key]
                continue
            new_task_id = str(uuid4())
            seen_tasks[key] = new_task_id
            task_id_map[task.id] = new_task_id
            db.add(
                MemberTask(
                    id=new_task_id,
                    tree_id=new_tree.id,
                    title=task.title,
                    notes=task.notes,
                    done=task.done,
                    created_at=task.created_at,
                    done_at=task.done_at,
                )
            )
            for mid in mapped_members:
                db.add(MemberTaskLink(task_id=new_task_id, member_id=mid))

    _progress(60)

    # --- Gallery images + links --------------------------------------------
    image_map: MemberIdMap = {}
    for t in sources:
        for img in db.scalars(select(GalleryImage).where(GalleryImage.tree_id == t.id)):
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
    db.flush()  # gallery images before their links
    seen_gallery_links: set[tuple] = set()
    for t in sources:
        links = db.scalars(
            select(GalleryMemberLink)
            .join(GalleryImage, GalleryImage.id == GalleryMemberLink.gallery_image_id)
            .where(GalleryImage.tree_id == t.id)
        )
        for link in links:
            gi = image_map.get(link.gallery_image_id)
            mid = member_map.get(link.member_id)
            if gi and mid and (gi, mid) not in seen_gallery_links:
                seen_gallery_links.add((gi, mid))
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

    # --- Gallery unknown-face tags ------------------------------------------
    # Regions carry over with their image, and ``task_id`` follows the task
    # into the merge via task_id_map (falling back to null if the task was
    # somehow not copied), so resolving/deleting the face after the merge
    # still closes the right task.
    for t in sources:
        faces = db.scalars(
            select(GalleryUnknownFace)
            .join(GalleryImage, GalleryImage.id == GalleryUnknownFace.gallery_image_id)
            .where(GalleryImage.tree_id == t.id)
        )
        for face in faces:
            gi = image_map.get(face.gallery_image_id)
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
                            task_id_map.get(face.task_id) if face.task_id else None
                        ),
                        created_at=face.created_at,
                    )
                )

    _progress(70)

    # --- Events + links ----------------------------------------------------
    event_map: MemberIdMap = {}
    for t in sources:
        for e in db.scalars(select(Event).where(Event.tree_id == t.id)):
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
    db.flush()  # events before their links
    seen_event_links: set[tuple] = set()
    for t in sources:
        links = db.scalars(
            select(EventMemberLink)
            .join(Event, Event.id == EventMemberLink.event_id)
            .where(Event.tree_id == t.id)
        )
        for link in links:
            ev = event_map.get(link.event_id)
            mid = member_map.get(link.member_id)
            if ev and mid and (ev, mid) not in seen_event_links:
                seen_event_links.add((ev, mid))
                db.add(EventMemberLink(event_id=ev, member_id=mid))

    _progress(80)

    # --- Stories + links ---------------------------------------------------
    story_map: MemberIdMap = {}
    for t in sources:
        for s in db.scalars(select(Story).where(Story.tree_id == t.id)):
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
    db.flush()  # stories before their links
    seen_story_links: set[tuple] = set()
    for t in sources:
        links = db.scalars(
            select(StoryMemberLink)
            .join(Story, Story.id == StoryMemberLink.story_id)
            .where(Story.tree_id == t.id)
        )
        for link in links:
            st = story_map.get(link.story_id)
            mid = member_map.get(link.member_id)
            if st and mid and (st, mid) not in seen_story_links:
                seen_story_links.add((st, mid))
                db.add(StoryMemberLink(story_id=st, member_id=mid))

    # --- Documents + files + links -----------------------------------------
    # Documents are reusable, tree-scoped content. Copy each source tree's
    # documents (with their files) into the new tree and repoint the merged
    # member/event/story links to the copies, so no link crosses a tree
    # boundary.
    document_map: MemberIdMap = {}
    for t in sources:
        for doc in db.scalars(select(Document).where(Document.tree_id == t.id)):
            new_id = str(uuid4())
            document_map[doc.id] = new_id
            db.add(
                Document(
                    id=new_id,
                    tree_id=new_tree.id,
                    title=doc.title,
                    document_date=doc.document_date,
                    description=doc.description,
                    created_at=doc.created_at,
                    updated_at=doc.updated_at,
                )
            )
    db.flush()  # documents before their files/links
    for t in sources:
        for f in db.scalars(
            select(DocumentFile)
            .join(Document, Document.id == DocumentFile.document_id)
            .where(Document.tree_id == t.id)
        ):
            new_doc_id = document_map.get(f.document_id)
            if new_doc_id is None:
                continue
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
    seen_doc_member_links: set[tuple] = set()
    for t in sources:
        for link in db.scalars(
            select(DocumentMemberLink)
            .join(Document, Document.id == DocumentMemberLink.document_id)
            .where(Document.tree_id == t.id)
        ):
            nd = document_map.get(link.document_id)
            mid = member_map.get(link.member_id)
            if nd and mid and (nd, mid) not in seen_doc_member_links:
                seen_doc_member_links.add((nd, mid))
                db.add(DocumentMemberLink(document_id=nd, member_id=mid))
    seen_event_doc_links: set[tuple] = set()
    for t in sources:
        for link in db.scalars(
            select(EventDocumentLink)
            .join(Document, Document.id == EventDocumentLink.document_id)
            .where(Document.tree_id == t.id)
        ):
            ev = event_map.get(link.event_id)
            nd = document_map.get(link.document_id)
            if ev and nd and (ev, nd) not in seen_event_doc_links:
                seen_event_doc_links.add((ev, nd))
                db.add(EventDocumentLink(event_id=ev, document_id=nd))
    seen_story_doc_links: set[tuple] = set()
    for t in sources:
        for link in db.scalars(
            select(StoryDocumentLink)
            .join(Document, Document.id == StoryDocumentLink.document_id)
            .where(Document.tree_id == t.id)
        ):
            st = story_map.get(link.story_id)
            nd = document_map.get(link.document_id)
            if st and nd and (st, nd) not in seen_story_doc_links:
                seen_story_doc_links.add((st, nd))
                db.add(StoryDocumentLink(story_id=st, document_id=nd))

    _progress(95)
    record_activity(
        db, tree_id=new_tree.id, actor=user, action="create",
        target_type="merge", target_id=new_tree.id, target_label=new_tree.name,
    )
    db.commit()
    db.refresh(new_tree)
    publish_tree_event(db, new_tree, "activity.entry_added", {"tree_id": new_tree.id})
    return new_tree
