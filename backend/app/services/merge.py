"""Server-side tree merge.

Combines one or two source trees into a brand-new tree owned by the requesting
user. Members are de-duplicated by (first name, last name, gender, birth, death)
— matching the old client-side merge — and notes from duplicates are combined.
All ids are regenerated (ids are globally unique here), relations/links are
remapped, and member photos / gallery media are copied into the new tree.
"""

from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import role_for
from app.core.constants import DEFAULT_RELATION_TYPES
from app.db.base import utcnow_iso
from app.models import (
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Member,
    MemberDisease,
    Relation,
    RelationType,
    Story,
    StoryMemberLink,
    Tree,
    User,
)
from app.services.storage import copy_media_to_tree


def _norm(value: str | None) -> str:
    return (value or "").strip().lower()


def _member_key(m: Member) -> tuple:
    return (_norm(m.firstName), _norm(m.lastName), m.gender, m.dateOfBirth, m.dateOfDeath)


def _require_readable(db: Session, user: User, tree_id: str) -> Tree:
    tree = db.get(Tree, tree_id)
    if tree is None or role_for(db, tree, user) is None:
        raise HTTPException(status_code=404, detail="Source tree not found")
    return tree


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
    )


def merge_trees(
    db: Session,
    user: User,
    name: str,
    source_a_id: str,
    source_b_id: str | None,
) -> Tree:
    tree_a = _require_readable(db, user, source_a_id)
    tree_b = _require_readable(db, user, source_b_id) if source_b_id else None
    sources = [t for t in (tree_a, tree_b) if t is not None]

    new_tree = Tree(
        id=str(uuid4()),
        name=name,
        owner_id=user.id,
        created_at=utcnow_iso(),
        last_opened=utcnow_iso(),
    )
    db.add(new_tree)
    db.flush()

    # --- Relation types (union, falling back to the defaults) --------------
    rtypes: set[str] = set()
    for t in sources:
        rtypes |= {
            rt.id
            for rt in db.scalars(
                select(RelationType).where(RelationType.tree_id == t.id)
            )
        }
    for rt in rtypes or set(DEFAULT_RELATION_TYPES):
        db.add(RelationType(tree_id=new_tree.id, id=rt))
    rtypes = rtypes or set(DEFAULT_RELATION_TYPES)

    # --- Members (with de-duplication across both sources) -----------------
    member_map: dict[str, str] = {}
    dedup: dict[tuple, Member] = {}
    for t in sources:
        for m in db.scalars(select(Member).where(Member.tree_id == t.id)):
            key = _member_key(m)
            match = dedup.get(key)
            if match is not None:
                member_map[m.id] = match.id
                if m.additionalData and m.additionalData != match.additionalData:
                    match.additionalData = (
                        f"{match.additionalData}\n\n{m.additionalData}"
                        if match.additionalData
                        else m.additionalData
                    )
            else:
                new_id = str(uuid4())
                member_map[m.id] = new_id
                clone = _clone_member(m, new_tree.id, new_id)
                db.add(clone)
                dedup[key] = clone

    valid_member_ids = set(member_map.values())

    # --- Relations ---------------------------------------------------------
    seen_relations: set[tuple] = set()
    for t in sources:
        for r in db.scalars(select(Relation).where(Relation.tree_id == t.id)):
            f = member_map.get(r.from_member_id)
            to = member_map.get(r.to_member_id)
            if not f or not to or r.relation_type not in rtypes:
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

    db.commit()
    db.refresh(new_tree)
    return new_tree
