"""Bounded-neighborhood traversal for the focused canvas.

The traversal walks the graph one generation at a time with indexed frontier
queries — the examined rows stay proportional to the frontier, never to the
workspace — and yields a *deterministic, append-only* sequence of member ids:

    root, descendant generations, ancestor generations, then partners,
    each level ordered by id.

Because that sequence only ever grows at the end as the node budget grows, a
continuation cursor needs to carry nothing but an offset into it (see
``neighborhood_cursor``): replaying page *n* returns exactly the ids page *n*
returned the first time, with no gaps and no duplicates.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Member, Relation, Section, SectionMember

# Per-request ceiling (and default) on returned members.
MAX_NEIGHBORHOOD_NODES = 1500
# Ceiling on what one cursor chain may deliver in total. Replay recomputes the
# sequence prefix, so the offset must stay bounded; past this the canvas is far
# beyond anything renderable anyway.
MAX_NEIGHBORHOOD_TOTAL = 20_000
# Ceiling on section include-filters per request.
MAX_SECTION_FILTERS = 50
# Bumped whenever the traversal order changes — cursors issued by an older
# algorithm no longer describe the same sequence and are rejected.
ALGORITHM_VERSION = 1

# Chunk size for ``IN (...)`` lists, kept well under SQLite's bound-parameter
# limit so a frontier the size of the node budget still issues valid SQL.
_IN_CHUNK = 500


@dataclass(frozen=True)
class NeighborhoodQuery:
    """Everything that determines the traversal sequence."""

    root_id: str
    up: int
    down: int
    include_partners: bool
    # Sorted for a stable cursor fingerprint; ``None`` means "no filter".
    section_ids: tuple[str, ...] | None
    budget: int


@dataclass
class NeighborhoodPage:
    #: This page's members, in traversal order.
    member_ids: list[str] = field(default_factory=list)
    #: Everything delivered up to and including this page — the set relations
    #: may attach to.
    delivered_ids: list[str] = field(default_factory=list)
    #: Whether the traversal has more members past this page.
    has_more: bool = False


def _chunks(ids: Iterable[str]) -> Iterator[list[str]]:
    batch: list[str] = []
    for member_id in ids:
        batch.append(member_id)
        if len(batch) == _IN_CHUNK:
            yield batch
            batch = []
    if batch:
        yield batch


def _parent_step(
    db: Session, workspace_id: str, frontier: set[str], *, upward: bool
) -> set[str]:
    """One generation across parent edges (convention: from=child, to=parent)."""
    found: set[str] = set()
    for chunk in _chunks(sorted(frontier)):
        column, filter_column = (
            (Relation.to_member_id, Relation.from_member_id)
            if upward
            else (Relation.from_member_id, Relation.to_member_id)
        )
        found.update(
            db.scalars(
                select(column).where(
                    Relation.workspace_id == workspace_id,
                    Relation.relation_type == "parent",
                    filter_column.in_(chunk),
                )
            )
        )
    return found


def _peer_step(db: Session, workspace_id: str, core: set[str]) -> set[str]:
    """One hop across non-parent edges (partners, siblings, …) out of *core*."""
    found: set[str] = set()
    for chunk in _chunks(sorted(core)):
        rows = db.execute(
            select(Relation.from_member_id, Relation.to_member_id).where(
                Relation.workspace_id == workspace_id,
                Relation.relation_type != "parent",
                or_(
                    Relation.from_member_id.in_(chunk),
                    Relation.to_member_id.in_(chunk),
                ),
            )
        ).all()
        for row in rows:
            found.add(row.from_member_id)
            found.add(row.to_member_id)
    return found - core


def _admissible(
    db: Session,
    workspace_id: str,
    candidates: set[str],
    section_ids: Sequence[str] | None,
) -> set[str]:
    """The candidates that exist in this workspace and pass the section filter."""
    if not candidates:
        return set()
    allowed: set[str] = set()
    for chunk in _chunks(sorted(candidates)):
        stmt = select(Member.id).where(
            Member.workspace_id == workspace_id, Member.id.in_(chunk)
        )
        if section_ids is not None:
            stmt = (
                stmt.join(SectionMember, SectionMember.member_id == Member.id)
                .where(SectionMember.section_id.in_(section_ids))
                .distinct()
            )
        allowed.update(db.scalars(stmt))
    return allowed


def _sequence(
    db: Session, workspace_id: str, query: NeighborhoodQuery, limit: int
) -> tuple[list[str], bool]:
    """Return ``(ordered_ids, complete)`` truncated to at most *limit* ids.

    The focus root is always included, even when a section filter excludes it:
    the filter narrows what the traversal walks *through*, it is not an access
    boundary (grants are resolved before this runs).
    """
    order: list[str] = [query.root_id]
    seen: set[str] = {query.root_id}
    complete = True

    def emit(member_ids: set[str]) -> bool:
        """Append *member_ids* in id order; False once *limit* is reached."""
        for member_id in sorted(member_ids):
            if member_id in seen:
                continue
            seen.add(member_id)
            order.append(member_id)
            if len(order) >= limit:
                return False
        return True

    for upward, depth in ((False, query.down), (True, query.up)):
        frontier = {query.root_id}
        # Candidates are marked examined whether or not they passed the section
        # filter, so a rejected member is never re-queried on a later level.
        examined = {query.root_id}
        for _ in range(depth):
            if not complete:
                break
            candidates = (
                _parent_step(db, workspace_id, frontier, upward=upward) - examined
            )
            if not candidates:
                break
            examined |= candidates
            frontier = _admissible(db, workspace_id, candidates, query.section_ids)
            if not frontier:
                break
            complete = emit(frontier)

    if query.include_partners and complete:
        peers = _peer_step(db, workspace_id, set(order))
        complete = emit(_admissible(db, workspace_id, peers, query.section_ids))

    return order, complete


def collect_neighborhood_page(
    db: Session, workspace_id: str, query: NeighborhoodQuery, offset: int
) -> NeighborhoodPage:
    """Return the page of the traversal sequence starting at *offset*."""
    ceiling = min(offset + query.budget, MAX_NEIGHBORHOOD_TOTAL)
    # One past the ceiling, so a full page can tell "exactly full" from "more".
    order, complete = _sequence(db, workspace_id, query, ceiling + 1)
    delivered = order[:ceiling]
    page = delivered[offset:]
    return NeighborhoodPage(
        member_ids=page,
        delivered_ids=delivered,
        has_more=not complete or len(order) > len(delivered),
    )


def relations_for_page(
    db: Session, workspace_id: str, page_ids: Sequence[str], delivered_ids: Sequence[str]
) -> list[Relation]:
    """The relations this page adds to what the caller already holds.

    Both endpoints must be delivered, and at least one must be new on this
    page: an edge crossing a page boundary ships with the later of its two
    endpoints, and an edge wholly inside earlier pages is not re-sent — so each
    edge travels exactly once over a cursor chain instead of the whole
    accumulated set travelling on every page.
    """
    delivered = set(delivered_ids)
    relations: list[Relation] = []
    seen: set[tuple[str, str, str]] = set()
    for chunk in _chunks(page_ids):
        for relation in db.scalars(
            select(Relation).where(
                Relation.workspace_id == workspace_id,
                or_(
                    Relation.from_member_id.in_(chunk),
                    Relation.to_member_id.in_(chunk),
                ),
            )
        ):
            if (
                relation.from_member_id not in delivered
                or relation.to_member_id not in delivered
            ):
                continue
            # A relation touching two members of different chunks comes back
            # from both queries.
            key = (
                relation.from_member_id,
                relation.to_member_id,
                relation.relation_type,
            )
            if key not in seen:
                seen.add(key)
                relations.append(relation)
    return relations


def resolve_section_ids(
    db: Session, workspace_id: str, section_ids: Sequence[str] | None
) -> tuple[str, ...] | None:
    """Validate section filters against *workspace_id*, sorted and deduplicated.

    ``None`` means no filter was requested; an empty tuple means one was, but
    nothing it named exists here — a filter that matches nobody, never a
    silently widened view. Unknown ids are dropped rather than rejected: which
    ids exist in a workspace is not something a filter should reveal.
    """
    if section_ids is None:
        return None
    requested = sorted(set(section_ids))[:MAX_SECTION_FILTERS]
    return tuple(
        sorted(
            db.scalars(
                select(Section.id).where(
                    Section.workspace_id == workspace_id, Section.id.in_(requested)
                )
            )
        )
    )


def continuation_counts(
    db: Session,
    workspace_id: str,
    section_ids: Sequence[str] | None,
    delivered_ids: Sequence[str],
    total_member_count: int,
) -> list[tuple[str | None, str | None, int]]:
    """``(section_id, section_name, remaining)`` per scope still holding members.

    Without section filters that is a single workspace-wide entry.
    """
    if section_ids is None:
        remaining = total_member_count - len(delivered_ids)
        return [(None, None, remaining)] if remaining > 0 else []

    totals = db.execute(
        select(Section.id, Section.name, func.count(SectionMember.member_id))
        .join(SectionMember, SectionMember.section_id == Section.id)
        .where(Section.workspace_id == workspace_id, Section.id.in_(section_ids))
        .group_by(Section.id, Section.name)
        .order_by(Section.position, Section.id)
    ).all()

    delivered: dict[str, int] = {}
    for chunk in _chunks(delivered_ids):
        for section_id, count in db.execute(
            select(SectionMember.section_id, func.count())
            .where(
                SectionMember.section_id.in_(section_ids),
                SectionMember.member_id.in_(chunk),
            )
            .group_by(SectionMember.section_id)
        ).all():
            delivered[section_id] = delivered.get(section_id, 0) + count

    counts = [
        (section_id, name, total - delivered.get(section_id, 0))
        for section_id, name, total in totals
    ]
    return [entry for entry in counts if entry[2] > 0]


def graph_revision(db: Session, workspace_id: str) -> str:
    """A cheap fingerprint of the graph a cursor was issued against.

    Counting rows keeps this to three indexed aggregates instead of hashing the
    graph itself. It catches every added or removed member, relation, and
    section assignment; re-pointing an existing edge without changing any count
    goes unnoticed, which at worst hands a replayed page a slightly different
    frontier — never a member the caller may not read.
    """
    members = db.scalar(
        select(func.count())
        .select_from(Member)
        .where(Member.workspace_id == workspace_id)
    )
    relations = db.scalar(
        select(func.count())
        .select_from(Relation)
        .where(Relation.workspace_id == workspace_id)
    )
    assignments = db.scalar(
        select(func.count())
        .select_from(SectionMember)
        .join(Section, Section.id == SectionMember.section_id)
        .where(Section.workspace_id == workspace_id)
    )
    return f"{members or 0}.{relations or 0}.{assignments or 0}"


def pick_default_root(
    db: Session, workspace_id: str, section_ids: Sequence[str] | None = None
) -> str | None:
    """Return the id of the most-connected member in scope, or ``None``.

    With section filters the pick is made inside those sections, so the default
    focus never lands on someone the requested view does not show.
    """
    relation_count = func.count().label("cnt")
    stmt = (
        select(Relation.from_member_id, relation_count)
        .where(Relation.workspace_id == workspace_id)
        .group_by(Relation.from_member_id)
        .order_by(relation_count.desc(), Relation.from_member_id)
        .limit(1)
    )
    member_stmt = select(Member.id).where(Member.workspace_id == workspace_id)
    if section_ids is not None:
        # Restrict with a subquery rather than a join: joining fans each
        # relation out once per section the member belongs to, which would
        # count section memberships instead of connections.
        in_sections = select(SectionMember.member_id).where(
            SectionMember.section_id.in_(section_ids)
        )
        stmt = stmt.where(Relation.from_member_id.in_(in_sections))
        member_stmt = member_stmt.where(Member.id.in_(in_sections))

    row = db.execute(stmt).first()
    if row is not None:
        return row.from_member_id
    # No relations in scope — fall back to the first member in insertion order.
    return db.scalar(member_stmt.order_by(Member.id).limit(1))
