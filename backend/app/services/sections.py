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

from app.core.exceptions import ConflictError, InvalidInputError, NotFoundError
from app.db.base import new_uuid, utcnow_iso
from app.models import (
    Member,
    Relation,
    Section,
    SectionMember,
    SectionPosition,
    Workspace,
    WorkspaceInvitation,
    WorkspaceSectionGrant,
    WorkspaceSectionPublicLink,
)
from app.schemas.extract import Direction
from app.schemas.provenance import SectionDependents
from app.schemas.section import SectionOut, SectionOverlap, SectionPreview
from app.services.members.member_access import get_member
from app.services.provenance import reassign_section_scopes, section_scope_counts
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


def member_counts(db: Session, section_ids: list[str]) -> dict[str, int]:
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
    counts = member_counts(db, [s.id for s in sections])
    return [section_out(s, counts.get(s.id, 0)) for s in sections]


def get_section(db: Session, tree: Workspace, section_id: str) -> Section:
    section = db.get(Section, section_id)
    if section is None or section.workspace_id != tree.id:
        raise NotFoundError("Section not found")
    return section


def _validate_name(
    db: Session, tree: Workspace, name: str, *, exclude_id: str | None = None
) -> str:
    """Fast pre-check for a friendly 409 in the common case.

    The actual guarantee is the DB's unique constraint on
    ``(workspace_id, name_normalized)`` (see ``models.section``) plus the
    route's ``IntegrityError`` handler — this check alone cannot close a
    same-millisecond race between two concurrent creates.
    """
    query = select(Section.id).where(
        Section.workspace_id == tree.id, Section.name_normalized == name.strip().lower()
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


def _grant_dependent_counts(db: Session, section_id: str) -> tuple[int, int, int]:
    grant_count = (
        db.scalar(
            select(func.count())
            .select_from(WorkspaceSectionGrant)
            .where(WorkspaceSectionGrant.section_id == section_id)
        )
        or 0
    )
    invitation_count = (
        db.scalar(
            select(func.count())
            .select_from(WorkspaceInvitation)
            .where(WorkspaceInvitation.section_id == section_id)
        )
        or 0
    )
    public_link_count = (
        db.scalar(
            select(func.count())
            .select_from(WorkspaceSectionPublicLink)
            .where(WorkspaceSectionPublicLink.section_id == section_id)
        )
        or 0
    )
    return grant_count, invitation_count, public_link_count


def section_dependents(db: Session, section: Section) -> SectionDependents:
    grant_count, invitation_count, public_link_count = _grant_dependent_counts(
        db, section.id
    )
    return SectionDependents(
        section_id=section.id,
        member_count=member_counts(db, [section.id]).get(section.id, 0),
        content_scope_counts=section_scope_counts(db, section.id),
        grant_count=grant_count,
        invitation_count=invitation_count,
        public_link_count=public_link_count,
    )


def delete_section(
    db: Session, tree: Workspace, section: Section, *, reassign_scope_to: str | None
) -> None:
    """Delete a section, never widening the audience of what it held.

    Content whose provenance points here has to go somewhere explicit: the
    caller either names another section to take it over or deletes the content
    first. Letting the section go and leaving the content workspace-wide would
    hand it to every collaborator — which is precisely what the database's
    RESTRICT on ``content_scopes`` refuses.

    Grants, invitations, and public links scoped here (#993) are the same
    story: reassigning their scope isn't well-defined (unlike content, a
    grant has no natural "next section"), so they must be explicitly revoked
    first — RESTRICT is the backstop for a race with this pre-check.
    """
    grant_count, invitation_count, public_link_count = _grant_dependent_counts(
        db, section.id
    )
    if grant_count or invitation_count or public_link_count:
        raise ConflictError(
            "Section still has grants, invitations, or public links; "
            "revoke them before deleting"
        )
    if section_scope_counts(db, section.id):
        if reassign_scope_to is None:
            raise ConflictError(
                "Section still holds content; reassign its scope before deleting"
            )
        target = get_section(db, tree, reassign_scope_to)
        if target.id == section.id:
            raise InvalidInputError("Cannot reassign a section's content to itself")
        reassign_section_scopes(
            db, from_section_id=section.id, to_section_id=target.id
        )
        db.flush()
    db.delete(section)


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
    get_member(db, tree, member_id)

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
            select(SectionMember.section_id)
            .join(Section, Section.id == SectionMember.section_id)
            .where(Section.workspace_id == tree.id, SectionMember.member_id == member_id)
        )
    )
    matches: dict[str, set[str]] = {}
    for section_id, related_member_id in db.execute(
        select(SectionMember.section_id, SectionMember.member_id)
        .join(Section, Section.id == SectionMember.section_id)
        .where(Section.workspace_id == tree.id, SectionMember.member_id.in_(related_ids))
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
    valid_ids: set[str] = set()
    if member_ids:
        valid_ids = set(
            db.scalars(
                select(Member.id).where(
                    Member.workspace_id == tree.id, Member.id.in_(set(member_ids))
                )
            )
        )
        for mid in valid_ids:
            db.add(SectionMember(section_id=section.id, member_id=mid))
    # A layout overlay only means something for a current member; drop any
    # left over from before this replace (mirrors virtual_view_matching.py's
    # pruning of orphaned position overlays on membership change).
    db.query(SectionPosition).filter(
        SectionPosition.section_id == section.id,
        SectionPosition.member_id.notin_(valid_ids),
    ).delete(synchronize_session=False)


def upsert_section_positions(
    db: Session, section: Section, items: list[tuple[str, float, float]]
) -> None:
    """Persist positions for members already assigned to ``section``.

    Silently drops items for anyone not currently a member — a layout
    overlay for someone not in the section would be meaningless.
    """
    if not items:
        return
    member_section_ids = {member_id for member_id, _, _ in items}
    valid_ids = set(
        db.scalars(
            select(SectionMember.member_id).where(
                SectionMember.section_id == section.id,
                SectionMember.member_id.in_(member_section_ids),
            )
        )
    )
    if not valid_ids:
        return
    existing = {
        p.member_id: p
        for p in db.scalars(
            select(SectionPosition).where(
                SectionPosition.section_id == section.id,
                SectionPosition.member_id.in_(valid_ids),
            )
        )
    }
    for member_id, position_x, position_y in items:
        if member_id not in valid_ids:
            continue
        row = existing.get(member_id)
        if row is not None:
            row.position_x = position_x
            row.position_y = position_y
        else:
            db.add(
                SectionPosition(
                    section_id=section.id,
                    member_id=member_id,
                    position_x=position_x,
                    position_y=position_y,
                )
            )
