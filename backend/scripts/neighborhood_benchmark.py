"""Benchmark ``collect_neighborhood_page`` against a fixture built by
``scripts.neighborhood_fixture`` (#1031).

Measures, per scenario (an unfiltered page, a section-filtered page, and a
full cursor replay chain up to ``MAX_NEIGHBORHOOD_TOTAL``): the number of SQL
statements issued, wall-clock latency, and peak resident memory of an
isolated subprocess doing the work — then captures a real PostgreSQL
``EXPLAIN (ANALYZE, BUFFERS)`` plan for each distinct query shape the
scenario ran, to confirm the frontier queries hit
``ix_relations_workspace_type_from`` / ``_to`` rather than scanning the table.

    uv run python -m scripts.neighborhood_benchmark \\
        --database-url postgresql+psycopg2://bench:bench@localhost:55432/bench \\
        --manifest manifest.json

Results in ``docs/PERFORMANCE.md`` were produced by this script.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.services.workspaces.neighborhood import (
    MAX_NEIGHBORHOOD_NODES,
    MAX_NEIGHBORHOOD_TOTAL,
    NeighborhoodQuery,
    collect_neighborhood_page,
    relations_for_page,
)

_SCENARIOS = ("unfiltered", "section_filtered", "cursor_chain")

# Collapses a run of bound-parameter placeholders (e.g. an IN-list) of any
# length to one marker, so two executions of the same query shape with
# different frontier sizes count as one "shape" for EXPLAIN purposes instead
# of one per distinct chunk length. Two passes because psycopg2's pyformat
# placeholders (``%(name)s``) themselves contain a ``)``, so a single regex
# matching up to the first ``)`` would stop inside the placeholder instead of
# at the end of the IN-list.
_PLACEHOLDER_RE = re.compile(r"%\([a-zA-Z0-9_]+\)s")
_PLACEHOLDER_RUN_RE = re.compile(r"\?(,\s*\?)*")


def _shape_key(statement: str) -> str:
    normalized = _PLACEHOLDER_RE.sub("?", statement)
    return _PLACEHOLDER_RUN_RE.sub("<PARAMS>", normalized)


@contextmanager
def _capture_statements(engine):
    statements: list[tuple[str, object]] = []

    def _before(conn, cursor, statement, parameters, context, executemany):
        if not executemany:
            statements.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", _before)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _before)


@dataclass
class PageMetrics:
    query_count: int
    wall_ms: float
    member_count: int
    relation_count: int
    has_more: bool


def _pick_root_section(manifest: dict, branch_index: int | None) -> dict:
    """Pick the section whose ``founder_id`` reaches the most members.

    Not ``member_count`` (every member ever assigned to the section, which
    can include disconnected fragments left behind when a lineage ran dry
    and was replaced — see ``neighborhood_fixture.start_component``): the
    traversal can only walk what's actually reachable from the root.
    """
    sections = manifest["sections"]
    if branch_index is not None:
        return sections[branch_index]
    return max(sections, key=lambda s: s["root_component_size"])


def _run_page(
    engine, workspace_id: str, query: NeighborhoodQuery, offset: int
) -> tuple[PageMetrics, list[tuple[str, object]]]:
    session = Session(bind=engine, autoflush=False, expire_on_commit=False)
    try:
        with _capture_statements(engine) as statements:
            started = time.perf_counter()
            page = collect_neighborhood_page(session, workspace_id, query, offset)
            relations = relations_for_page(
                session, workspace_id, page.member_ids, page.delivered_ids
            )
            elapsed_ms = (time.perf_counter() - started) * 1000
        metrics = PageMetrics(
            query_count=len(statements),
            wall_ms=elapsed_ms,
            member_count=len(page.member_ids),
            relation_count=len(relations),
            has_more=page.has_more,
        )
        return metrics, statements
    finally:
        session.close()


def _build_query(
    scenario: str, manifest: dict, branch_index: int | None
) -> NeighborhoodQuery:
    section = _pick_root_section(manifest, branch_index)
    return NeighborhoodQuery(
        root_id=section["founder_id"],
        up=0,
        down=20,
        include_partners=True,
        section_ids=(section["id"],) if scenario == "section_filtered" else None,
        budget=MAX_NEIGHBORHOOD_NODES,
    )


def run_scenario_in_process(
    database_url: str, manifest: dict, scenario: str, branch_index: int | None
) -> dict:
    """Run *scenario* to completion; return aggregate metrics (no EXPLAIN)."""
    engine = create_engine(database_url, future=True)
    try:
        query = _build_query(scenario, manifest, branch_index)
        if scenario in ("unfiltered", "section_filtered"):
            metrics, _ = _run_page(engine, manifest["workspace_id"], query, offset=0)
            return {"pages": 1, **asdict(metrics)}

        # cursor_chain: replay pages until the traversal or the total ceiling
        # is exhausted, mirroring what the route's cursor loop does.
        offset = 0
        pages = 0
        total_queries = 0
        total_wall_ms = 0.0
        total_members = 0
        while True:
            metrics, _ = _run_page(engine, manifest["workspace_id"], query, offset)
            pages += 1
            total_queries += metrics.query_count
            total_wall_ms += metrics.wall_ms
            total_members += metrics.member_count
            offset += metrics.member_count
            if not metrics.has_more or offset >= MAX_NEIGHBORHOOD_TOTAL:
                break
        return {
            "pages": pages,
            "query_count": total_queries,
            "wall_ms": total_wall_ms,
            "member_count": total_members,
            "relation_count": None,
            "has_more": metrics.has_more,
            "avg_queries_per_page": total_queries / pages,
            "avg_wall_ms_per_page": total_wall_ms / pages,
        }
    finally:
        engine.dispose()


def explain_scenario(
    database_url: str, manifest: dict, scenario: str, branch_index: int | None
) -> list[str]:
    """Re-run *scenario*'s first page, EXPLAIN each distinct query shape."""
    engine = create_engine(database_url, future=True)
    try:
        query = _build_query(scenario, manifest, branch_index)
        _, statements = _run_page(engine, manifest["workspace_id"], query, offset=0)
        # Keep the highest-cardinality execution of each query shape: later
        # generations bind IN-lists of hundreds of ids where the first is a
        # single id, and PostgreSQL can pick a different plan (up to and
        # including a sequential scan) as list size grows — explaining only
        # the first occurrence would miss exactly the plan this is meant to
        # verify.
        seen: dict[str, tuple[str, object]] = {}
        for statement, params in statements:
            key = _shape_key(statement)
            if key not in seen or len(params) > len(seen[key][1]):
                seen[key] = (statement, params)

        plans = []
        with engine.connect() as conn:
            for i, (statement, params) in enumerate(seen.values(), start=1):
                rows = conn.exec_driver_sql(
                    f"EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) {statement}", params
                ).all()
                plan_text = "\n".join(row[0] for row in rows)
                header = f"-- query shape {i}/{len(seen)}"
                plans.append(f"{header}\n{statement}\n\n{plan_text}")
        return plans
    finally:
        engine.dispose()


def _run_isolated(
    database_url: str, manifest_path: str, scenario: str, branch_index: int | None
) -> tuple[dict, int]:
    """Run *scenario* in a subprocess so peak RSS is isolated per scenario."""
    cmd = [
        sys.executable,
        "-m",
        "scripts.neighborhood_benchmark",
        "--database-url",
        database_url,
        "--manifest",
        manifest_path,
        "--run-scenario",
        scenario,
    ]
    if branch_index is not None:
        cmd += ["--branch-index", str(branch_index)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=sys.stderr, text=True)
    _, _, rusage = os.wait4(proc.pid, 0)
    stdout, _ = proc.communicate()
    return json.loads(stdout), rusage.ru_maxrss  # KB on Linux


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument(
        "--manifest", required=True, help="Manifest from scripts.neighborhood_fixture"
    )
    parser.add_argument(
        "--branch-index",
        type=int,
        default=None,
        help="Which manifest section to use as root (default: the largest).",
    )
    parser.add_argument(
        "--run-scenario",
        choices=_SCENARIOS,
        help=argparse.SUPPRESS,  # internal: single-scenario subprocess mode
    )
    parser.add_argument(
        "--out", help="Write the full report (including EXPLAIN plans) here."
    )
    args = parser.parse_args()

    if not args.database_url:
        parser.error("--database-url or $DATABASE_URL is required")

    with open(args.manifest) as f:
        manifest = json.load(f)

    if args.run_scenario:
        # Subprocess mode: do the work, print exactly one JSON line, exit.
        result = run_scenario_in_process(
            args.database_url, manifest, args.run_scenario, args.branch_index
        )
        print(json.dumps(result))
        return

    report_lines = [f"# Neighborhood benchmark — {manifest['member_count']} members\n"]
    for scenario in _SCENARIOS:
        metrics, peak_rss_kb = _run_isolated(
            args.database_url, args.manifest, scenario, args.branch_index
        )
        plans = explain_scenario(
            args.database_url, manifest, scenario, args.branch_index
        )
        peak_rss_mib = peak_rss_kb / 1024
        report_lines.append(f"## {scenario}\n")
        report_lines.append(f"```json\n{json.dumps(metrics, indent=2)}\n```\n")
        report_lines.append(f"Peak RSS (isolated subprocess): {peak_rss_mib:.1f} MiB\n")
        report_lines.append("### EXPLAIN plans\n")
        for plan in plans:
            report_lines.append(f"```\n{plan}\n```\n")
        summary = f"{scenario}: {json.dumps(metrics)} peak_rss_mib={peak_rss_mib:.1f}"
        print(summary, file=sys.stderr)

    report = "\n".join(report_lines)
    if args.out:
        with open(args.out, "w") as f:
            f.write(report)
    else:
        print(report)


if __name__ == "__main__":
    main()
