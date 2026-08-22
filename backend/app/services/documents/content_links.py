"""Shared helpers for replacing link-table rows on content items (gallery
images, events, stories, documents)."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import InstrumentedAttribute

from app.db.base import Base
from app.models.content import Document
from app.models.family import Member
from app.models.tree import Tree


def replace_member_links(
    db: Session,
    *,
    link_model: type[Base],
    parent_fk: InstrumentedAttribute,
    parent_id: str,
    tree: Tree,
    member_ids: list[str],
) -> None:
    """Replace a content item's member links, keeping only members of `tree`."""
    db.query(link_model).filter(parent_fk == parent_id).delete()
    if not member_ids:
        return
    valid_ids = db.scalars(
        select(Member.id).where(
            Member.tree_id == tree.id,
            Member.id.in_(set(member_ids)),
        )
    ).all()
    for mid in valid_ids:
        db.add(link_model(**{parent_fk.key: parent_id, "member_id": mid}))


def replace_gallery_member_links(
    db: Session,
    *,
    image_id: str,
    tree: Tree,
    links: list,
) -> None:
    """Replace gallery links while retaining each optional normalized region."""
    from app.models.content import GalleryMemberLink

    db.query(GalleryMemberLink).filter(
        GalleryMemberLink.gallery_image_id == image_id
    ).delete()
    if not links:
        return

    valid_ids = set(
        db.scalars(
            select(Member.id).where(
                Member.tree_id == tree.id,
                Member.id.in_({link.member_id for link in links}),
            )
        ).all()
    )
    for link in links:
        if link.member_id not in valid_ids:
            continue
        db.add(
            GalleryMemberLink(
                gallery_image_id=image_id,
                member_id=link.member_id,
                x=link.x,
                y=link.y,
                w=link.w,
                h=link.h,
            )
        )


def replace_document_links(
    db: Session,
    *,
    link_model: type[Base],
    parent_fk: InstrumentedAttribute,
    parent_id: str,
    tree: Tree,
    document_ids: list[str],
) -> None:
    """Replace an event/story's document links, keeping only documents of `tree`."""
    db.query(link_model).filter(parent_fk == parent_id).delete()
    if not document_ids:
        return
    valid_ids = db.scalars(
        select(Document.id).where(
            Document.tree_id == tree.id,
            Document.id.in_(set(document_ids)),
        )
    ).all()
    for did in valid_ids:
        db.add(link_model(**{parent_fk.key: parent_id, "document_id": did}))
