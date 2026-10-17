"""Bounded-neighborhood traversal for the focused canvas.

The traversal walks the graph one generation at a time with indexed frontier
queries — the examined rows stay proportional to the frontier, never to the
workspace — and yields a *deterministic, append-only* sequence of member ids:

    root, descendant generations, ancestor generations, then partners,
    each level ordered by id.

A section-filtered traversal walks the whole family inside the section
instead: every member within ``up`` generations above and ``down`` below the
root's, reached hop by hop over parent and (with partners) peer edges —
siblings, in-laws and cousins included — each hop ordered by id. A section is
a family branch, so focusing it must not depend on which single lineage the
default root happens to sit on.

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
# Depth meaning "all the way": far past any real family's generation count, so
# the walk simply runs until a direction has no one left (still capped by the
# node budget). Saved views store it literally for an unlimited direction.
ALL_GENERATIONS = 999
# Ceiling on section include-filters per request.
MAX_SECTION_FILTERS = 50
# Bumped whenever the traversal order changes — cursors issued by an older
# algorithm no longer describe the same sequence and are rejected.
ALGORITHM_VERSION = 2

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
    # #984: the caller's access boundary — ``None`` means unrestricted (every
    # section visible). Deliberately excluded from ``query_fingerprint``: it
    # is not a shape the caller chose, and ``visibility_fingerprint()``
    # already retires a cursor when a principal's grants change. Kept
    # separate from ``section_ids`` (the view filter) throughout this module
    # so a request that asks to see everything still only ever *walks*
    # through what the caller may actually read.
    visible_section_ids: frozenset[str] | None = None


@dataclass
class NeighborhoodPage:
    #: This page's members, in traversal order.
    member_ids: list[str] = field(default_factory=list)
    #: Everything delivered up to and including this page — the set relations
    #: may attach to.
    delivered_ids: list[str] = field(default_factory=list)
    #: Whether the traversal has more members past this page.
    has_more: bool = False
    #: Whether one more generation up or down would reach anyone new.
    expandable: bool = False


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


def _edge_step(
    db: Session, workspace_id: str, frontier: set[str], *, include_peers: bool
) -> list[tuple[str, str, int]]:
    """``(source, target, generation delta)`` for every edge out of *frontier*.

    A parent edge (from=child, to=parent) moves one generation up from the
    child and one down from the parent; a peer edge stays on the generation.
    Sorted, so callers resolving a target reached twice do so deterministically.
    """
    steps: set[tuple[str, str, int]] = set()
    for chunk in _chunks(sorted(frontier)):
        stmt = select(
            Relation.from_member_id, Relation.to_member_id, Relation.relation_type
        ).where(
            Relation.workspace_id == workspace_id,
            or_(
                Relation.from_member_id.in_(chunk),
                Relation.to_member_id.in_(chunk),
            ),
        )
        if not include_peers:
            stmt = stmt.where(Relation.relation_type == "parent")
        for from_id, to_id, relation_type in db.execute(stmt):
            delta = 1 if relation_type == "parent" else 0
            if from_id in frontier:
                steps.add((from_id, to_id, delta))
            if to_id in frontier:
                steps.add((to_id, from_id, -delta))
    return sorted(steps)


def _admissible(
    db: Session,
    workspace_id: str,
    candidates: set[str],
    section_ids: Sequence[str] | None,
    visible_section_ids: frozenset[str] | None,
) -> set[str]:
    """The candidates that exist in this workspace, pass the section *view*
    filter (``section_ids``), and fall inside the caller's *access* boundary
    (``visible_section_ids``) — two independent conditions (#984): a request
    may legitimately ask to see everything it can read, so the access check
    can never be satisfied by reusing the view filter's section-id list.
    """
    if not candidates:
        return set()
    allowed: set[str] = set()
    for chunk in _chunks(sorted(candidates)):
        stmt = select(Member.id).where(
            Member.workspace_id == workspace_id, Member.id.in_(chunk)
        )
        if section_ids is not None:
            stmt = stmt.where(
                Member.id.in_(
                    select(SectionMember.member_id).where(
                        SectionMember.section_id.in_(section_ids)
                    )
                )
            )
        if visible_section_ids is not None:
            stmt = stmt.where(
                Member.id.in_(
                    select(SectionMember.member_id).where(
                        SectionMember.section_id.in_(visible_section_ids)
                    )
                )
            )
        allowed.update(db.scalars(stmt))
    return allowed


def _sequence(
    db: Session, workspace_id: str, query: NeighborhoodQuery, limit: int
) -> tuple[list[str], bool, bool]:
    """Return ``(ordered_ids, complete, expandable)`` truncated to at most
    *limit* ids; ``expandable`` says whether a deeper ``up``/``down`` would
    reach anyone new (always true for an incomplete sequence).

    The focus root is always included, even when a section filter excludes it:
    the filter narrows what the traversal walks *through*, it is not an access
    boundary (grants are resolved before this runs).
    """
    if query.section_ids is not None:
        return _family_sequence(db, workspace_id, query, limit)

    order: list[str] = [query.root_id]
    seen: set[str] = {query.root_id}
    complete = True
    expandable = False

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
        level = 0
        while level < depth and complete:
            candidates = (
                _parent_step(db, workspace_id, frontier, upward=upward) - examined
            )
            if not candidates:
                break
            examined |= candidates
            frontier = _admissible(
                db,
                workspace_id,
                candidates,
                query.section_ids,
                query.visible_section_ids,
            )
            if not frontier:
                break
            complete = emit(frontier)
            level += 1
        if complete and level == depth and not expandable:
            # The walk used its whole depth: one more generation is only worth
            # offering when it would actually reach someone.
            beyond = _parent_step(db, workspace_id, frontier, upward=upward) - examined
            expandable = bool(
                _admissible(
                    db, workspace_id, beyond, query.section_ids, query.visible_section_ids
                )
            )

    if query.include_partners and complete:
        peers = _peer_step(db, workspace_id, set(order))
        complete = emit(
            _admissible(
                db, workspace_id, peers, query.section_ids, query.visible_section_ids
            )
        )

    return order, complete, expandable or not complete


def _family_sequence(
    db: Session, workspace_id: str, query: NeighborhoodQuery, limit: int
) -> tuple[list[str], bool, bool]:
    """The section-filtered walk: hop by hop over every edge kind, keeping
    whoever lands within the root's generation band (see the module docs)."""
    order: list[str] = [query.root_id]
    generation: dict[str, int] = {query.root_id: 0}
    # Members that failed the section filter — never walked through.
    rejected: set[str] = set()
    # Reached only outside the band so far; anyone in here not delivered by the
    # end is what a deeper band would add.
    beyond: set[str] = set()
    frontier = {query.root_id}
    complete = True

    while frontier and complete:
        candidates: dict[str, int] = {}
        for source, target, delta in _edge_step(
            db, workspace_id, frontier, include_peers=query.include_partners
        ):
            if target in generation or target in rejected or target in candidates:
                continue
            target_generation = generation[source] + delta
            if -query.down <= target_generation <= query.up:
                candidates[target] = target_generation
            else:
                beyond.add(target)
        admitted = _admissible(
            db,
            workspace_id,
            set(candidates),
            query.section_ids,
            query.visible_section_ids,
        )
        rejected |= set(candidates) - admitted
        frontier = set()
        for member_id in sorted(admitted):
            generation[member_id] = candidates[member_id]
            order.append(member_id)
            frontier.add(member_id)
            if len(order) >= limit:
                complete = False
                break

    if not complete:
        return order, False, True
    expandable = bool(
        _admissible(
            db,
            workspace_id,
            beyond - generation.keys() - rejected,
            query.section_ids,
            query.visible_section_ids,
        )
    )
    return order, True, expandable


def collect_neighborhood_page(
    db: Session, workspace_id: str, query: NeighborhoodQuery, offset: int
) -> NeighborhoodPage:
    """Return the page of the traversal sequence starting at *offset*."""
    ceiling = min(offset + query.budget, MAX_NEIGHBORHOOD_TOTAL)
    # One past the ceiling, so a full page can tell "exactly full" from "more".
    order, complete, expandable = _sequence(db, workspace_id, query, ceiling + 1)
    delivered = order[:ceiling]
    page = delivered[offset:]
    return NeighborhoodPage(
        member_ids=page,
        delivered_ids=delivered,
        has_more=not complete or len(order) > len(delivered),
        expandable=expandable,
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
    db: Session,
    workspace_id: str,
    section_ids: Sequence[str] | None,
    *,
    visible_section_ids: frozenset[str] | None = None,
) -> tuple[str, ...] | None:
    """Validate section filters against *workspace_id*, sorted and deduplicated.

    ``None`` means no filter was requested; an empty tuple means one was, but
    nothing it named exists here — a filter that matches nobody, never a
    silently widened view. Unknown ids are dropped rather than rejected: which
    ids exist in a workspace is not something a filter should reveal.

    ``visible_section_ids`` (#984) — the caller's access boundary, ``None``
    for unrestricted — is intersected in for the same reason: a section a
    scoped caller cannot read must drop out of the filter rather than surface
    as "matches nothing" (which would at least confirm the id exists).
    """
    if section_ids is None:
        return None
    requested = sorted(set(section_ids))[:MAX_SECTION_FILTERS]
    resolved = set(
        db.scalars(
            select(Section.id).where(
                Section.workspace_id == workspace_id, Section.id.in_(requested)
            )
        )
    )
    if visible_section_ids is not None:
        resolved &= visible_section_ids
    return tuple(sorted(resolved))


def continuation_counts(
    db: Session,
    workspace_id: str,
    section_ids: Sequence[str] | None,
    delivered_ids: Sequence[str],
    total_member_count: int,
) -> list[tuple[str | None, str | None, int]]:
    """``(section_id, section_name, remaining)`` per scope still holding members.

    Without section filters that is a single workspace-wide entry.

    Counts only readable members (#984) by construction rather than by
    filtering here: the caller passes an already visibility-intersected
    ``section_ids`` (see ``resolve_section_ids``) and an already
    visibility-filtered ``total_member_count``, and every member of a
    section the caller may name is, by definition, a member they may read.
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
    db: Session,
    workspace_id: str,
    section_ids: Sequence[str] | None = None,
    *,
    visible_section_ids: frozenset[str] | None = None,
) -> str | None:
    """Return the id of the most-connected member in scope, or ``None``.

    With section filters the pick is made inside those sections, so the default
    focus never lands on someone the requested view does not show. Same for
    ``visible_section_ids`` (#984): a scoped caller's default root always
    lands inside what they may actually read, filter or not.
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
    for scope in (section_ids, visible_section_ids):
        if scope is None:
            continue
        # Restrict with a subquery rather than a join: joining fans each
        # relation out once per section the member belongs to, which would
        # count section memberships instead of connections.
        in_sections = select(SectionMember.member_id).where(
            SectionMember.section_id.in_(scope)
        )
        stmt = stmt.where(Relation.from_member_id.in_(in_sections))
        member_stmt = member_stmt.where(Member.id.in_(in_sections))

    row = db.execute(stmt).first()
    if row is not None:
        return row.from_member_id
    # No relations in scope — fall back to the first member in insertion order.
    return db.scalar(member_stmt.order_by(Member.id).limit(1))
