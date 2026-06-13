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

from typing import TYPE_CHECKING
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
from app.schemas.family import MemberOut
from app.schemas.merge import DuplicatePair, MergeResolution, TreeMergePreview
from app.services.storage import copy_media_to_tree

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

def _norm(value: str | None) -> str:
    return (value or "").strip().lower()


def _empty(value: str | None) -> bool:
    """True when the value should be treated as absent (None or blank)."""
    return not (value or "").strip()


def _member_key(m: Member) -> tuple:
    """Exact-duplicate key: name + gender + both dates (all normalised)."""
    return (_norm(m.firstName), _norm(m.lastName), m.gender, m.dateOfBirth, m.dateOfDeath)


def _member_name_key(m: Member) -> tuple:
    """Name + gender only — used for possible-candidate detection."""
    return (_norm(m.firstName), _norm(m.lastName), m.gender)


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

_CONFLICT_FIELDS: list[str] = [
    "maidenName",
    "birthplace",
    "hometown",
    "placesLived",
    "additionalData",
    "imageData",
    "dateOfBirth",
    "dateOfDeath",
]


def _compute_conflicts(a: Member, b: Member) -> list[str]:
    """Return field names where the two members differ in a meaningful way."""
    conflicts: list[str] = []
    for field in _CONFLICT_FIELDS:
        va = getattr(a, field, None)
        vb = getattr(b, field, None)
        if field == "imageData":
            # Report conflict only when both are set and differ
            if not _empty(va) and not _empty(vb) and va != vb:
                conflicts.append(field)
        else:
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
        exact_by_key[_member_key(m)] = m
        name_by_key[_member_name_key(m)] = m

    duplicates: list[DuplicatePair] = []
    exact_matched_b_ids: set[str] = set()
    possible_matched_b_ids: set[str] = set()

    # First pass: exact duplicates
    for mb in members_b:
        exact_key = _member_key(mb)
        if exact_key in exact_by_key:
            ma = exact_by_key[exact_key]
            conflicts = _compute_conflicts(ma, mb)
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
        name_key = _member_name_key(mb)
        if name_key in name_by_key:
            ma = name_by_key[name_key]
            # Sanity check: must not be an exact match (already handled above)
            if _member_key(ma) == _member_key(mb):
                continue
            conflicts = _compute_conflicts(ma, mb)
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
        firstName=m.firstName,
        lastName=m.lastName,
        maidenName=m.maidenName,
        imageData=copy_media_to_tree(m.imageData, new_tree_id),
        dateOfBirth=m.dateOfBirth,
        dateOfDeath=m.dateOfDeath,
        additionalData=m.additionalData,
        isCollapsed=m.isCollapsed,
        positionX=m.positionX,
        positionY=m.positionY,
        birthplace=m.birthplace,
        hometown=m.hometown,
        placesLived=m.placesLived,
    )


def _apply_field_choices(
    clone: Member,
    ma: Member,
    mb: Member,
    fields: dict[str, str],
) -> None:
    """Apply per-field resolution choices to a merged clone.

    ``clone`` was already built from ``ma`` (source A); we apply overrides here.
    ``fields`` maps field_name → "a" | "b" | "combine".
    """
    text_fields = {"additionalData", "placesLived"}
    choosable = {
        "maidenName", "birthplace", "hometown", "placesLived",
        "additionalData", "imageData", "dateOfBirth", "dateOfDeath",
    }
    for field, choice in fields.items():
        if field not in choosable:
            continue
        va = getattr(ma, field, None)
        vb = getattr(mb, field, None)
        if choice == "a":
            setattr(clone, field, va)
        elif choice == "b":
            setattr(clone, field, vb)
        elif choice == "combine" and field in text_fields:
            separator = "\n\n" if field == "additionalData" else ", "
            parts = [p for p in [va, vb] if not _empty(p)]
            # Deduplicate while preserving order
            seen: list[str] = []
            for p in parts:
                if p not in seen:
                    seen.append(p)
            setattr(clone, field, separator.join(seen) if seen else None)


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
) -> Tree:
    tree_a = _require_readable(db, user, source_a_id)
    tree_b = _require_readable(db, user, source_b_id) if source_b_id else None
    sources = [t for t in (tree_a, tree_b) if t is not None]

    res_index = _build_resolution_index(resolutions)

    new_tree = Tree(
        id=str(uuid4()),
        name=name,
        owner_id=user.id,
        created_at=utcnow_iso(),
        last_opened=utcnow_iso(),
    )
    db.add(new_tree)
    db.flush()

    # --- Members (with de-duplication across both sources) -----------------
    # member_map: source member id → new tree member id
    member_map: dict[str, str] = {}
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
        dedup[_member_key(ma)] = clone
        name_index[_member_name_key(ma)] = (clone, ma.id)

    # ---- Pass 2: process source-B members ----
    for mb in members_b:
        exact_key = _member_key(mb)
        name_key = _member_name_key(mb)

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
                        _apply_field_choices(
                            matched_a_clone, orig_ma, mb, resolution.fields
                        )
                else:
                    # Legacy behaviour: combine additionalData
                    if (
                        mb.additionalData
                        and mb.additionalData != matched_a_clone.additionalData
                    ):
                        matched_a_clone.additionalData = (
                            f"{matched_a_clone.additionalData}\n\n{mb.additionalData}"
                            if matched_a_clone.additionalData
                            else mb.additionalData
                        )
        else:
            # No match: always clone as new
            new_id = str(uuid4())
            member_map[mb.id] = new_id
            clone = _clone_member(mb, new_tree.id, new_id)
            db.add(clone)

    # Members must exist before relations/diseases/links reference them.
    db.flush()

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
            key = (mid, _norm(d.name))
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

    # --- Gallery images + links --------------------------------------------
    image_map: dict[str, str] = {}
    for t in sources:
        for img in db.scalars(select(GalleryImage).where(GalleryImage.tree_id == t.id)):
            new_id = str(uuid4())
            image_map[img.id] = new_id
            db.add(
                GalleryImage(
                    id=new_id,
                    tree_id=new_tree.id,
                    imageData=copy_media_to_tree(img.imageData, new_tree.id),
                    title=img.title,
                    description=img.description,
                    createdAt=img.createdAt,
                    uploadedAt=img.uploadedAt,
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
                db.add(GalleryMemberLink(gallery_image_id=gi, member_id=mid))

    # --- Events + links ----------------------------------------------------
    event_map: dict[str, str] = {}
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

    # --- Stories + links ---------------------------------------------------
    story_map: dict[str, str] = {}
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

    # --- Story attachments (copy files into the new tree) ------------------
    for t in sources:
        for att in db.scalars(
            select(StoryAttachment).where(StoryAttachment.tree_id == t.id)
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
