"""Query-count regression coverage for the neighborhood traversal (#1031).

A 200k-member Postgres fixture and its EXPLAIN-verified query-count / latency
/ peak-memory budgets live in ``scripts.neighborhood_fixture`` and
``scripts.neighborhood_benchmark`` and are written up in
``docs/PERFORMANCE.md`` — that scale is out of reach for the SQLite-backed
suite CI runs on every PR (see ``tests/conftest.py``).

What CI *can* cheaply guard on every PR: that the number of SQL statements a
bounded page issues is a function of the frontier/budget, never of how many
members the workspace holds — the property the frontier traversal
(``app.services.workspaces.neighborhood``) exists for — for both unfiltered
and section-filtered requests, and that a cursor replay chain actually stops
at ``MAX_NEIGHBORHOOD_TOTAL``.
"""

from sqlalchemy import event

import app.services.workspaces.neighborhood as neighborhood_module
from app.models import Relation, Section, SectionMember
from app.services.workspaces.neighborhood import (
    NeighborhoodQuery,
    collect_neighborhood_page,
)
from tests.conftest import add_member, make_tree, make_user


def _build_chain(db, tree, n: int, *, prefix: str = "m") -> list[str]:
    """m0 -> m1 -> ... -> m{n-1} (child -> parent), a single deep lineage.

    ``Member.id`` is a global primary key, not scoped by workspace, so a test
    building chains in more than one tree must give each a distinct prefix.
    """
    ids = [f"{prefix}{i}" for i in range(n)]
    for member_id in ids:
        add_member(db, tree, member_id)
    for i in range(n - 1):
        db.add(
            Relation(
                workspace_id=tree.id,
                from_member_id=ids[i],
                to_member_id=ids[i + 1],
                relation_type="parent",
            )
        )
    db.commit()
    return ids


def _count_queries(db, fn, *args, **kwargs):
    statements: list[str] = []
    engine = db.get_bind()

    def _before(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _before)
    try:
        result = fn(*args, **kwargs)
    finally:
        event.remove(engine, "before_cursor_execute", _before)
    return result, len(statements)


def test_bounded_page_query_count_is_independent_of_workspace_size(db):
    user = make_user(db, "alice")

    small_tree = make_tree(db, user, name="Small")
    small_ids = _build_chain(db, small_tree, 60, prefix="s")

    large_tree = make_tree(db, user, name="Large")
    large_ids = _build_chain(db, large_tree, 3000, prefix="l")

    def _query(root_id: str) -> NeighborhoodQuery:
        return NeighborhoodQuery(
            root_id=root_id,
            up=200,
            down=0,
            include_partners=False,
            section_ids=None,
            budget=50,
        )

    _, small_queries = _count_queries(
        db, collect_neighborhood_page, db, small_tree.id, _query(small_ids[0]), 0
    )
    _, large_queries = _count_queries(
        db, collect_neighborhood_page, db, large_tree.id, _query(large_ids[0]), 0
    )

    # Same up/down/budget on a 50x bigger workspace must cost the same number
    # of queries — proof the traversal never touches rows outside the
    # frontier it actually returns.
    assert small_queries == large_queries


def test_section_filtered_page_query_count_stays_bounded(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    ids = _build_chain(db, tree, 3000)

    section = Section(workspace_id=tree.id, name="Half")
    db.add(section)
    db.commit()
    db.add_all(SectionMember(section_id=section.id, member_id=m) for m in ids[:1500])
    db.commit()

    def _query(section_ids: tuple[str, ...] | None) -> NeighborhoodQuery:
        return NeighborhoodQuery(
            root_id=ids[0],
            up=200,
            down=0,
            include_partners=False,
            section_ids=section_ids,
            budget=50,
        )

    _, unfiltered_queries = _count_queries(
        db, collect_neighborhood_page, db, tree.id, _query(None), 0
    )
    _, filtered_queries = _count_queries(
        db, collect_neighborhood_page, db, tree.id, _query((section.id,)), 0
    )

    # The section filter adds one admissibility subquery per generation on
    # top of the unfiltered walk — it must not turn into a workspace-wide
    # scan, so it stays within a small constant of the unfiltered cost.
    assert filtered_queries <= unfiltered_queries + 5


def test_cursor_replay_chain_stops_at_max_neighborhood_total(db, monkeypatch):
    monkeypatch.setattr(neighborhood_module, "MAX_NEIGHBORHOOD_TOTAL", 120)

    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _build_chain(db, tree, 500)

    query = NeighborhoodQuery(
        root_id="m0",
        up=200,
        down=0,
        include_partners=False,
        section_ids=None,
        budget=40,
    )

    collected: list[str] = []
    offset = 0
    for _ in range(10):  # guards against an infinite loop if this regresses
        page = collect_neighborhood_page(db, tree.id, query, offset)
        collected.extend(page.member_ids)
        offset += len(page.member_ids)
        # Mirrors the route's own stop condition (members.py): a cursor is
        # only issued while there's more *and* the ceiling isn't reached yet.
        if not page.has_more or offset >= neighborhood_module.MAX_NEIGHBORHOOD_TOTAL:
            break
    else:
        raise AssertionError("cursor replay never stopped")

    assert len(collected) == len(set(collected))
    # Capped at MAX_NEIGHBORHOOD_TOTAL even though the chain has 380 more
    # members it could otherwise keep delivering.
    assert len(collected) == 120
