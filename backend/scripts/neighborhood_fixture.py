"""Generate a synthetic multi-hundred-thousand-member Postgres fixture (#1031).

``GET /workspaces/{id}/members/neighborhood`` (``app.services.workspaces.
neighborhood``) has no fixture at production scale, so its query-count /
latency / memory budgets have never been measured against anything bigger
than a unit test can afford to build. This script builds one workspace whose
size and edge density (parent chains, partner marriages, section branches)
are representative of a real genealogy: a forest of family branches, each its
own section, growing generation by generation with a couple of children per
family and most children marrying in a partner.

Run against a disposable Postgres database only — with ``--reset`` this drops
and recreates every application table first (``Base.metadata.create_all``),
and even without it, it writes real rows.

    uv run python -m scripts.neighborhood_fixture \\
        --database-url postgresql+psycopg2://bench:bench@localhost:55432/bench \\
        --reset

Prints a JSON manifest (workspace id, and each section's id/name/founder
id/member count) to stdout and, with ``--manifest-out``, to a file — input
for ``scripts.neighborhood_benchmark``.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time

from sqlalchemy import create_engine, insert
from sqlalchemy.engine import Connection

import app.models  # noqa: F401  registers every table on Base.metadata
from app.core.security import hash_password
from app.db.base import Base, new_uuid, utcnow_iso
from app.db.init_db import DEFAULT_RELATION_TYPES
from app.models import (
    Member,
    Relation,
    RelationType,
    Section,
    SectionMember,
    User,
    Workspace,
)

# Children per couple, and the probability a child marries in a new partner —
# chosen to grow a branch by roughly 2x per generation, similar to a real
# family tree, without the wild variance a naive uniform distribution gives.
_CHILD_COUNTS = [0, 1, 2, 3, 4]
_CHILD_WEIGHTS = [5, 15, 40, 30, 10]
_PARTNER_PROBABILITY = 0.7


def _member_id(prefix: str, n: int) -> str:
    # Prefixed with (a slice of) the owning workspace id so member ids stay
    # globally unique — the primary key isn't scoped by workspace_id — across
    # however many workspaces one fixture run generates.
    return f"m{prefix}{n:07d}"


def _parent_row(workspace_id: str, child_id: str, parent_id: str) -> dict:
    return {
        "workspace_id": workspace_id,
        "from_member_id": child_id,
        "to_member_id": parent_id,
        "relation_type": "parent",
    }


def _partner_row(workspace_id: str, a_id: str, b_id: str) -> dict:
    return {
        "workspace_id": workspace_id,
        "from_member_id": a_id,
        "to_member_id": b_id,
        "relation_type": "partner",
    }


def generate(
    conn: Connection,
    *,
    target_members: int,
    num_sections: int,
    seed: int,
    batch_size: int,
    workspace_name: str,
) -> dict:
    """Populate *conn*'s database; return the fixture manifest."""
    rng = random.Random(seed)

    owner_id = new_uuid()
    workspace_id = new_uuid()

    conn.execute(
        insert(User.__table__),
        [
            {
                "id": owner_id,
                "username": f"bench-owner-{workspace_id[:8]}",
                "hashed_password": hash_password("bench-fixture-only"),
                "is_admin": True,
            }
        ],
    )
    conn.execute(
        insert(Workspace.__table__),
        [{"id": workspace_id, "name": workspace_name, "owner_id": owner_id}],
    )
    existing_types = {row[0] for row in conn.execute(RelationType.__table__.select())}
    missing_types = [t for t in DEFAULT_RELATION_TYPES if t not in existing_types]
    if missing_types:
        conn.execute(insert(RelationType.__table__), [{"id": t} for t in missing_types])

    sections = [
        {
            "id": new_uuid(),
            "workspace_id": workspace_id,
            "name": f"Branch {i}",
            "name_normalized": f"branch {i}",
            "position": i,
            "created_at": utcnow_iso(),
        }
        for i in range(num_sections)
    ]
    conn.execute(insert(Section.__table__), sections)
    conn.commit()

    member_buf: list[dict] = []
    relation_buf: list[dict] = []
    section_member_buf: list[dict] = []

    def flush() -> None:
        if member_buf:
            conn.execute(insert(Member.__table__), member_buf)
            member_buf.clear()
        if relation_buf:
            conn.execute(insert(Relation.__table__), relation_buf)
            relation_buf.clear()
        if section_member_buf:
            conn.execute(insert(SectionMember.__table__), section_member_buf)
            section_member_buf.clear()
        conn.commit()

    next_id = 0
    id_prefix = workspace_id[:8]

    def new_member(section_index: int, *, first_name: str) -> str:
        nonlocal next_id
        member_id = _member_id(id_prefix, next_id)
        next_id += 1
        member_buf.append(
            {
                "id": member_id,
                "workspace_id": workspace_id,
                "first_name": first_name,
                "last_name": f"Branch{section_index}",
                "gender": rng.choice(["m", "f"]),
            }
        )
        section_member_buf.append(
            {"section_id": sections[section_index]["id"], "member_id": member_id}
        )
        return member_id

    # One founder couple per section, so each section is a genuinely large,
    # independently filterable subtree rather than a thin slice of one graph.
    branch_queue: list[list[tuple[str, str | None]]] = []
    founders: list[str] = []
    branch_sizes = [0] * num_sections
    created = 0
    for s in range(num_sections):
        a = new_member(s, first_name="Founder")
        founders.append(a)
        branch_sizes[s] += 1
        created += 1
        b = None
        if rng.random() < _PARTNER_PROBABILITY and created < target_members:
            b = new_member(s, first_name="Founder")
            relation_buf.append(_partner_row(workspace_id, a, b))
            branch_sizes[s] += 1
            created += 1
        branch_queue.append([(a, b)])

    section_cursor = 0
    started = time.monotonic()
    while created < target_members:
        s = section_cursor % num_sections
        section_cursor += 1
        queue = branch_queue[s]
        if not queue:
            # A branch can run dry if every couple in it turned out
            # childless; keep the section growing rather than stalling.
            a = new_member(s, first_name="Founder")
            queue.append((a, None))
            branch_sizes[s] += 1
            created += 1
            continue
        parent_a, parent_b = queue.pop(0)
        num_children = rng.choices(_CHILD_COUNTS, weights=_CHILD_WEIGHTS)[0]
        for _ in range(num_children):
            if created >= target_members:
                break
            child = new_member(s, first_name="Person")
            relation_buf.append(_parent_row(workspace_id, child, parent_a))
            if parent_b is not None:
                relation_buf.append(_parent_row(workspace_id, child, parent_b))
            branch_sizes[s] += 1
            created += 1
            partner = None
            if created < target_members and rng.random() < _PARTNER_PROBABILITY:
                partner = new_member(s, first_name="Partner")
                relation_buf.append(_partner_row(workspace_id, child, partner))
                branch_sizes[s] += 1
                created += 1
            queue.append((child, partner))

        if len(member_buf) >= batch_size:
            flush()
            elapsed = time.monotonic() - started
            print(
                f"  {created:>8}/{target_members} members "
                f"({created / max(elapsed, 1e-9):.0f}/s)",
                file=sys.stderr,
            )

    flush()

    return {
        "workspace_id": workspace_id,
        "owner_id": owner_id,
        "member_count": created,
        "seed": seed,
        "sections": [
            {
                "id": sections[i]["id"],
                "name": sections[i]["name"],
                "founder_id": founders[i],
                "member_count": branch_sizes[i],
            }
            for i in range(num_sections)
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="Postgres SQLAlchemy URL (defaults to $DATABASE_URL). Must be a "
        "disposable benchmark database.",
    )
    parser.add_argument("--members", type=int, default=200_000)
    parser.add_argument(
        "--sections",
        type=int,
        default=8,
        help="Number of independent family branches / sections. Fewer, "
        "bigger sections make each one large enough to exercise the "
        "cursor replay chain up to MAX_NEIGHBORHOOD_TOTAL on its own.",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--batch-size", type=int, default=5_000)
    parser.add_argument("--workspace-name", default="Neighborhood Benchmark")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Drop and recreate every application table before generating.",
    )
    parser.add_argument("--manifest-out", help="Path to also write the JSON manifest to.")
    parser.add_argument(
        "--noise-workspaces",
        type=int,
        default=0,
        help="Extra, unrelated workspaces to also generate, so the "
        "benchmark workspace isn't the table's only tenant — real "
        "deployments share `relations`/`members` across many workspaces, "
        "which is what gives the (workspace_id, ...) indexes their "
        "selectivity. 0 skips this (single-tenant, worst-case plans).",
    )
    parser.add_argument("--noise-members", type=int, default=15_000)
    args = parser.parse_args()

    if not args.database_url:
        parser.error("--database-url or $DATABASE_URL is required")
    if "sqlite" in args.database_url:
        parser.error(
            "this fixture is for Postgres EXPLAIN-verified plans; SQLite "
            "query plans aren't comparable to production"
        )

    engine = create_engine(args.database_url, future=True)
    if args.reset:
        print("Dropping and recreating all tables...", file=sys.stderr)
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    with engine.connect() as conn:
        manifest = generate(
            conn,
            target_members=args.members,
            num_sections=args.sections,
            seed=args.seed,
            batch_size=args.batch_size,
            workspace_name=args.workspace_name,
        )
        for i in range(args.noise_workspaces):
            print(
                f"Generating noise workspace {i + 1}/{args.noise_workspaces}...",
                file=sys.stderr,
            )
            generate(
                conn,
                target_members=args.noise_members,
                num_sections=2,
                seed=args.seed + i + 1,
                batch_size=args.batch_size,
                workspace_name=f"Noise {i}",
            )
        manifest["noise_workspaces"] = args.noise_workspaces
        manifest["noise_members"] = args.noise_members * args.noise_workspaces

    payload = json.dumps(manifest, indent=2)
    print(payload)
    if args.manifest_out:
        with open(args.manifest_out, "w") as f:
            f.write(payload)


if __name__ == "__main__":
    main()
