"""Visibility-safe, section-aware workspace search (#1024).

Unlike ``app.services.members.member_search`` (used by the tree-local quick
search and the cross-workspace search), this queries the single indexed
``Member.name_normalized`` column instead of three unindexed per-field
``ILIKE`` scans, and every result is annotated with the caller's readable
section labels through ``WorkspaceAccessContext`` (#984) rather than only
being filtered by it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import Member, Section, SectionMember
from app.services.members.member_search import MEMBER_SURFACE_COLUMNS
from app.services.workspaces.visibility import WorkspaceAccessContext

#: Bumped whenever the matching or ordering logic below changes, so a cursor
#: minted under an old algorithm is rejected rather than replayed against a
#: sequence it no longer describes.
SEARCH_ALGORITHM_VERSION = 1

_YEAR_TOKEN = re.compile(r"\d{4}")


def _token_clause(token: str):
    """OR clause matching a single query token against one member.

    Mirrors ``member_search._token_clause`` field-for-field (first/last/maiden
    name, plus birth/death year for a 4-digit token), but against the single
    indexed ``name_normalized`` column instead of three separate ones.
    """
    pattern = f"%{token}%"
    clauses = [Member.name_normalized.ilike(pattern)]
    if _YEAR_TOKEN.fullmatch(token):
        clauses += [
            Member.date_of_birth.ilike(pattern),
            Member.date_of_death.ilike(pattern),
        ]
    return or_(*clauses)


def workspace_search_name_clause(query: str):
    """Same tokenization rule as ``member_name_search_clause``: a multi-token
    query is split on whitespace and AND-ed token by token."""
    tokens = query.split()
    if len(tokens) <= 1:
        return _token_clause(query)
    return and_(*(_token_clause(token) for token in tokens))


@dataclass(frozen=True)
class SectionLabel:
    id: str
    name: str


@dataclass(frozen=True)
class WorkspaceSearchHit:
    row: object  # a MEMBER_SURFACE_COLUMNS row mapping
    sections: tuple[SectionLabel, ...]
    unassigned: bool


def search_revision(db: Session, workspace_id: str) -> str:
    """A cheap fingerprint of the searchable set, for stale-page detection.

    Counting rows keeps this to two indexed aggregates instead of hashing
    every name. It catches every added or removed member and every changed
    section assignment; a same-count rename or a same-count reassignment
    (moved out of one section, into another) goes unnoticed — mirroring the
    same accepted tradeoff as ``neighborhood.graph_revision``: at worst a
    replayed page sees a slightly different slice, never a member the caller
    may not read (that boundary is re-checked on every request from the
    caller's *current* ``WorkspaceAccessContext``, not from the cursor).
    """
    members = db.scalar(
        select(func.count())
        .select_from(Member)
        .where(Member.workspace_id == workspace_id)
    )
    assignments = db.scalar(
        select(func.count())
        .select_from(SectionMember)
        .join(Section, Section.id == SectionMember.section_id)
        .where(Section.workspace_id == workspace_id)
    )
    return f"{members}:{assignments}"


def _order_by():
    return (Member.name_normalized, Member.last_name, Member.first_name, Member.id)


def count_workspace_search(
    db: Session, workspace_id: str, context: WorkspaceAccessContext, q: str
) -> int:
    filters = [Member.workspace_id == workspace_id, workspace_search_name_clause(q)]
    member_filter = context.member_filter()
    if member_filter is not None:
        filters.append(member_filter)
    return db.scalar(select(func.count(Member.id)).where(*filters)) or 0


def fetch_workspace_search_page(
    db: Session,
    workspace_id: str,
    context: WorkspaceAccessContext,
    q: str,
    *,
    offset: int,
    limit: int,
) -> list[WorkspaceSearchHit]:
    """One page of matches plus each hit's readable section labels.

    Section labels are fetched in one bulk query keyed off the page's member
    ids — never per-hit — so this stays a fixed number of queries regardless
    of page size.
    """
    filters = [Member.workspace_id == workspace_id, workspace_search_name_clause(q)]
    member_filter = context.member_filter()
    if member_filter is not None:
        filters.append(member_filter)
    rows = db.execute(
        select(*MEMBER_SURFACE_COLUMNS)
        .where(*filters)
        .order_by(*_order_by())
        .offset(offset)
        .limit(limit)
    ).all()
    if not rows:
        return []

    member_ids = [row.id for row in rows]
    visible_section_ids = context.visible_section_ids()
    section_filters = [SectionMember.member_id.in_(member_ids)]
    if visible_section_ids is not None:
        # A scoped caller must never learn that a hit also sits in a section
        # they cannot read — narrow the join itself, not just the label list.
        section_filters.append(SectionMember.section_id.in_(visible_section_ids))
    section_rows = db.execute(
        select(SectionMember.member_id, Section.id, Section.name)
        .join(Section, Section.id == SectionMember.section_id)
        .where(*section_filters)
        .order_by(Section.name, Section.id)
    ).all()
    sections_by_member: dict[str, list[SectionLabel]] = {}
    for member_id, section_id, section_name in section_rows:
        sections_by_member.setdefault(member_id, []).append(
            SectionLabel(id=section_id, name=section_name)
        )

    unrestricted = context.unrestricted
    hits = []
    for row in rows:
        sections = tuple(sections_by_member.get(row.id, ()))
        hits.append(
            WorkspaceSearchHit(
                row=row,
                sections=sections,
                # Only a whole-workspace caller can tell "no sections at
                # all" apart from "sections I can't see" — a scoped caller's
                # hits always have at least one readable section, since
                # ``context.member_filter()`` already required one.
                unassigned=unrestricted and not sections,
            )
        )
    return hits
