"""Shared helper for replacing member links on gallery images, events, and stories."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import InstrumentedAttribute

from app.db.base import Base
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
