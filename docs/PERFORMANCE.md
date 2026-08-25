# Neighborhood query budgets

`GET /workspaces/{id}/members/neighborhood` (frontier traversal in
[`app/services/workspaces/neighborhood.py`](../backend/app/services/workspaces/neighborhood.py))
is the single graph endpoint behind the focused canvas: sections, budgets,
and continuation cursors (#983, #1026). Its correctness has unit-test
coverage (`backend/tests/test_neighborhood*.py`); this document is about its
cost at production scale, measured against a 200,000-member PostgreSQL
fixture with `EXPLAIN (ANALYZE, BUFFERS)`-verified query plans (#1031).

## Tooling

Two standalone scripts, run from `backend/` against a **disposable** Postgres
database — never point either at real data:

- **`scripts/neighborhood_fixture.py`** generates the fixture: a forest of
  family branches (one per section) growing generation by generation, each
  child getting 0–2 recorded parents and, most of the time, a partner —
  representative edge density rather than one worst-case shape.
- **`scripts/neighborhood_benchmark.py`** runs three scenarios against that
  fixture — an unfiltered page, a section-filtered page, and a full cursor
  replay chain up to `MAX_NEIGHBORHOOD_TOTAL` — and for each, measures SQL
  statement count, wall-clock latency, and peak RSS of an isolated
  subprocess, then re-runs the first page once more under `EXPLAIN (ANALYZE,
  BUFFERS)` to capture a real plan for every distinct query shape it issued.

```bash
cd backend
docker run -d --name neighborhood-bench-pg \
  -e POSTGRES_USER=bench -e POSTGRES_PASSWORD=bench -e POSTGRES_DB=bench \
  -p 55432:5432 postgres:18-alpine

DB_URL=postgresql+psycopg2://bench:bench@localhost:55432/bench

# 200k members in one workspace, plus 20 smaller "noise" workspaces (see
# "Fixture shape" below for why the noise matters).
uv run python -m scripts.neighborhood_fixture \
  --database-url "$DB_URL" --members 200000 --sections 8 --reset \
  --noise-workspaces 20 --noise-members 15000 \
  --manifest-out manifest.json

uv run python -m scripts.neighborhood_benchmark \
  --database-url "$DB_URL" --manifest manifest.json --out report.md
```

Re-run this against your own deployment's hardware/network for numbers that
apply to it — the latency figures below are specific to the sandbox they were
measured in (see the caveat under "Latency").

## Fixture shape

- 200,000 members in the benchmark workspace, spread across 8 sections of
  ~25,000 members each — comfortably above `MAX_NEIGHBORHOOD_TOTAL` (20,000),
  so a single section can exercise a full cursor replay chain to the ceiling
  on its own.
- ~282,000 `parent`/`partner` relations in that workspace (~1.4 edges per
  member — most members have one parent recorded and about 70% have a
  partner; some have two parents).
- 20 additional smaller workspaces (15,000 members each) generated alongside
  it, so the benchmark workspace is ~40% of the `relations` table (705,489
  rows total) rather than 100% of it. This matters for plan realism: with
  *only* the benchmark workspace in the table, `relations_for_page`'s
  `workspace_id`-only filter isn't selective (it matches every row), and
  PostgreSQL correctly prefers a `Parallel Seq Scan` over an unselective
  index range scan — a true result, but not the one a real multi-tenant
  deployment sees. With the workspace at a realistic ~40% table share, every
  query in every scenario below plans as an index or bitmap-index scan.

## Measured budgets (200k members, default `budget=1500`, `up=0, down=20,
partners=true`, rooted at a section founder)

| Scenario | Queries/page | Peak RSS (isolated) |
|---|---|---|
| Unfiltered page | 28 | ~65 MiB |
| Section-filtered page | 28 | ~65 MiB |
| Full cursor replay to `MAX_NEIGHBORHOOD_TOTAL` (14 pages) | 1,109 total | ~90 MiB |

28 queries per page = ~25 for the frontier walk itself (one indexed query per
generation examined, up to `down=20`) + 3 for `relations_for_page` fetching
that page's edges in `_IN_CHUNK`-sized (500) batches. The section filter adds
one admissibility subquery per generation but the *same* 28-query total here,
because the traversal is already bounded by `down`/`budget`, not by workspace
size — confirmed generically (any workspace size, not just this fixture) by
`backend/tests/test_neighborhood_query_budget.py`, which runs on every PR.

### Cursor replay chain

Replaying the full chain to the 20,000-node ceiling costs *more than 14x* a
single page — the per-page query count grows as the offset grows (28 → 40 →
64 → 131 across the 14 pages), because replay recomputes the sequence prefix
from scratch each time (see the module docstring in `neighborhood.py`: *"the
offset must stay bounded"*). This is by design, not a regression — it's
exactly what `MAX_NEIGHBORHOOD_TOTAL` exists to bound. A client that
legitimately needs to walk a 20,000-node neighborhood pays for it once, in
~14 separate page requests; a much larger ceiling would make the last few
pages of a chain like that increasingly expensive.

### Latency

Single-page wall time in the sandbox this was measured in (Postgres in a
Docker container, reached over a forwarded `localhost` port — not a
colocated `docker-compose` network) ranged ~100–190ms, split roughly evenly
between the frontier walk and `relations_for_page`. Neither half is
PostgreSQL-bound: every individual query in the `EXPLAIN ANALYZE` output
below executes in well under a millisecond. `relations_for_page`'s share is
ORM row hydration (`db.scalars(select(Relation)...)` builds ~1,500 mapped
objects) rather than the query itself; the frontier walk's share is
almost entirely per-query round-trip overhead (28 sequential round trips).
**Treat the specific millisecond figures as sandbox-specific** — re-run
`scripts.neighborhood_benchmark` against your own deployment for numbers
that transfer. The query-count and EXPLAIN-plan results above are not
sandbox-specific and are the load-bearing part of this budget.

## EXPLAIN-verified plans

With the fixture's realistic ~40% table share, every query PostgreSQL plans
across all three scenarios is an index scan or bitmap-index scan — no
sequential scan anywhere:

```
Index Scan using ix_relations_workspace_type_to on relations
  Index Cond: ((workspace_id = $1) AND (relation_type = 'parent') AND (to_member_id = ANY ($2)))
  Execution Time: 0.03–0.15 ms

Index Scan using members_pkey on members
  Index Cond: (id = ANY ($1))
  Filter: (workspace_id = $2)
  Execution Time: 0.02–0.09 ms

-- relations_for_page, larger chunks:
Bitmap Heap Scan on relations
  ->  Bitmap Index Scan on ix_relations_workspace_type_to / relations_pkey
  Execution Time: 0.5–3.7 ms
```

The two indexes added in #1026
(`ix_relations_workspace_type_from` / `ix_relations_workspace_type_to`) are
what make the frontier walk an index lookup per generation instead of a
scan; `relations_for_page`'s edge fetch instead rides the `relations` table's
own primary key (`workspace_id, from_member_id, to_member_id,
relation_type`) once its `workspace_id` filter is selective. Full plans for
every distinct query shape are in a generated `report.md` (see "Tooling"
above) — not checked in, since it's ~1,700 lines of raw `EXPLAIN` output tied
to one run's specific ids and row counts.

## Known follow-up candidate (not fixed here)

`relations_for_page` fetches full ORM `Relation` objects
(`db.scalars(select(Relation)...)`) purely to serialize four columns; on the
40%-share fixture that's the majority of a page's Python-side latency
(profiled: ~60% of wall time), independent of the query plan. If the latency
budget above ever needs to tighten, switching it to a column-only `select()`
(as `_parent_step`/`_admissible` already do) is the next lever — not a new
index.
