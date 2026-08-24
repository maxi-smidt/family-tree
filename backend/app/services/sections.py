"""Sections: named, overlapping organizational branches inside a workspace.

Creating or deleting a section only ever writes ``Section``/``SectionMember``/
``SectionPosition`` rows — it never copies, moves, or deletes a person,
relation, or piece of content. Membership seeding reuses the same branch
traversal as sub-tree extraction (``app.services.workspaces.subtree_selection``),
recomputed from the live ``(root_member_id, direction)`` pair at creation time
rather than trusting an earlier preview response — the same anti-staleness
approach ``extract_subtree`` uses for its own preview/commit pair.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.db.base import new_uuid, utcnow_iso
from app.models import (
    Member,
    Relation,
    Section,
    SectionMember,
    SectionPosition,
    Workspace,
)
from app.schemas.extract import Direction
from app.schemas.section import SectionOut, SectionOverlap, SectionPreview
from app.services.workspaces.subtree_selection import collect_member_ids


def section_out(section: Section, member_count: int = 0) -> SectionOut:
    return SectionOut(
        id=section.id,
        workspace_id=section.workspace_id,
        name=section.name,
        position=section.position,
        created_at=section.created_at,
        member_count=member_count,
    )


def _member_counts(db: Session, section_ids: list[str]) -> dict[str, int]:
    if not section_ids:
        return {}
    return dict(
        db.execute(
            select(SectionMember.section_id, func.count())
            .where(SectionMember.section_id.in_(section_ids))
            .group_by(SectionMember.section_id)
        ).all()
    )


def list_sections(db: Session, tree: Workspace) -> list[SectionOut]:
    sections = list(
        db.scalars(
            select(Section)
            .where(Section.workspace_id == tree.id)
            .order_by(Section.position, Section.created_at)
        )
    )
    counts = _member_counts(db, [s.id for s in sections])
    return [section_out(s, counts.get(s.id, 0)) for s in sections]


def get_section(db: Session, tree: Workspace, section_id: str) -> Section:
    section = db.get(Section, section_id)
    if section is None or section.workspace_id != tree.id:
        raise NotFoundError("Section not found")
    return section


def _validate_name(
    db: Session, tree: Workspace, name: str, *, exclude_id: str | None = None
) -> str:
    query = select(Section.id).where(
        Section.workspace_id == tree.id, func.lower(Section.name) == name.lower()
    )
    if exclude_id is not None:
        query = query.where(Section.id != exclude_id)
    if db.scalar(query) is not None:
        raise ConflictError("A section with this name already exists")
    return name


def _next_position(db: Session, tree: Workspace) -> int:
    max_position = db.scalar(
        select(func.max(Section.position)).where(Section.workspace_id == tree.id)
    )
    return 0 if max_position is None else max_position + 1


def _seed_member_ids(
    db: Session, tree: Workspace, root_member_id: str, direction: Direction
) -> set[str]:
    """The traversal branch reachable from ``root_member_id``, including the
    root itself (unlike ``collect_member_ids``, which excludes it for
    extraction's bridge-person semantics — a section has no bridge)."""
    return collect_member_ids(db, tree.id, root_member_id, direction) | {root_member_id}


def create_section(
    db: Session,
    tree: Workspace,
    *,
    name: str,
    root_member_id: str | None,
    direction: Direction,
) -> Section:
    name = _validate_name(db, tree, name)
    section = Section(
        id=new_uuid(),
        workspace_id=tree.id,
        name=name,
        position=_next_position(db, tree),
        created_at=utcnow_iso(),
    )
    db.add(section)
    db.flush()
    if root_member_id is not None:
        for member_id in _seed_member_ids(db, tree, root_member_id, direction):
            db.add(SectionMember(section_id=section.id, member_id=member_id))
    return section


def update_section(
    db: Session,
    tree: Workspace,
    section: Section,
    *,
    name: str | None,
    position: int | None,
) -> Section:
    if name is not None and name != section.name:
        section.name = _validate_name(db, tree, name, exclude_id=section.id)
    if position is not None:
        section.position = position
    return section


def _boundary_member_ids(relations: list[Relation], primary: set[str]) -> set[str]:
    boundary: set[str] = set()
    for r in relations:
        from_in = r.from_member_id in primary
        to_in = r.to_member_id in primary
        if from_in and not to_in:
            boundary.add(r.to_member_id)
        elif to_in and not from_in:
            boundary.add(r.from_member_id)
    return boundary


def _section_overlaps(
    db: Session, tree: Workspace, member_ids: set[str]
) -> list[SectionOverlap]:
    if not member_ids:
        return []
    rows = db.execute(
        select(Section.id, Section.name, func.count(SectionMember.member_id))
        .join(SectionMember, SectionMember.section_id == Section.id)
        .where(Section.workspace_id == tree.id, SectionMember.member_id.in_(member_ids))
        .group_by(Section.id, Section.name)
    ).all()
    return [
        SectionOverlap(section_id=sid, section_name=name, member_count=count)
        for sid, name, count in rows
    ]


def compute_section_preview(
    db: Session, tree: Workspace, root_member_id: str, direction: Direction
) -> SectionPreview:
    primary = _seed_member_ids(db, tree, root_member_id, direction)
    relations = list(
        db.scalars(select(Relation).where(Relation.workspace_id == tree.id))
    )
    boundary = _boundary_member_ids(relations, primary)
    return SectionPreview(
        primary_member_ids=sorted(primary),
        boundary_member_ids=sorted(boundary),
        overlaps=_section_overlaps(db, tree, boundary),
    )


def suggest_sections_for_member(
    db: Session, tree: Workspace, member_id: str
) -> list[tuple[Section, list[str]]]:
    """Sections to suggest for ``member_id``, based on the sections their
    parents/partners already belong to (any relation, since only "parent" is
    a directionally special type — see subtree_selection.py)."""
    member = db.scalar(
        select(Member).where(Member.workspace_id == tree.id, Member.id == member_id)
    )
    if member is None:
        raise NotFoundError("Member not found in this workspace")

    relations = db.scalars(
        select(Relation).where(
            Relation.workspace_id == tree.id,
            (Relation.from_member_id == member_id) | (Relation.to_member_id == member_id),
        )
    )
    related_ids = {
        r.to_member_id if r.from_member_id == member_id else r.from_member_id
        for r in relations
    }
    if not related_ids:
        return []

    already_in = set(
        db.scalars(
            select(SectionMember.section_id).where(SectionMember.member_id == member_id)
        )
    )
    matches: dict[str, set[str]] = {}
    for section_id, related_member_id in db.execute(
        select(SectionMember.section_id, SectionMember.member_id).where(
            SectionMember.member_id.in_(related_ids)
        )
    ).all():
        if section_id in already_in:
            continue
        matches.setdefault(section_id, set()).add(related_member_id)
    if not matches:
        return []

    sections = {
        s.id: s
        for s in db.scalars(
            select(Section).where(
                Section.workspace_id == tree.id, Section.id.in_(matches.keys())
            )
        )
    }
    return sorted(
        (
            (sections[sid], sorted(member_ids))
            for sid, member_ids in matches.items()
            if sid in sections
        ),
        key=lambda pair: (pair[0].position, pair[0].created_at),
    )


def replace_section_members(
    db: Session, tree: Workspace, section: Section, member_ids: list[str]
) -> None:
    db.query(SectionMember).filter(SectionMember.section_id == section.id).delete()
    if not member_ids:
        return
    valid_ids = db.scalars(
        select(Member.id).where(
            Member.workspace_id == tree.id, Member.id.in_(set(member_ids))
        )
    ).all()
    for mid in valid_ids:
        db.add(SectionMember(section_id=section.id, member_id=mid))


def upsert_section_positions(
    db: Session,
    tree: Workspace,
    section: Section,
    items: list[tuple[str, float, float]],
) -> None:
    if not items:
        return
    valid_ids = set(
        db.scalars(
            select(Member.id).where(
                Member.workspace_id == tree.id,
                Member.id.in_({member_id for member_id, _, _ in items}),
            )
        )
    )
    for member_id, position_x, position_y in items:
        if member_id not in valid_ids:
            continue
        existing = db.get(SectionPosition, (section.id, member_id))
        if existing is not None:
            existing.position_x = position_x
            existing.position_y = position_y
        else:
            db.add(
                SectionPosition(
                    section_id=section.id,
                    member_id=member_id,
                    position_x=position_x,
                    position_y=position_y,
                )
            )
