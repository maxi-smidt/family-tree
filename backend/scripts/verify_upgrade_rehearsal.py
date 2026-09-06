"""Verify a packaged v1 -> v2 upgrade rehearsal (#1022).

Companion to ``scripts.seed_v1_fixture``: that script seeds a legacy-shaped
fixture into a blank database *before* the packaged backend image starts;
this one drives the checks against the running candidate image afterwards.
Three independent checks, run as subcommands so the release workflow can
call each at the right point in the container lifecycle:

    uv run python -m scripts.verify_upgrade_rehearsal wait-for-migration \\
        --base-url http://localhost:8001 --timeout 300

    uv run python -m scripts.verify_upgrade_rehearsal check-postconditions \\
        --database-url postgresql+psycopg2://familytree:familytree@localhost:5433/ft \\
        --manifest manifest.json

    uv run python -m scripts.verify_upgrade_rehearsal assert-single-run \\
        --database-url postgresql+psycopg2://familytree:familytree@localhost:5433/familytree

Each subcommand prints what it found and exits non-zero on failure so the
calling workflow step fails loudly instead of silently passing a broken
rehearsal.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx
from sqlalchemy import create_engine, text


def wait_for_migration(base_url: str, timeout: float, poll_interval: float) -> int:
    deadline = time.monotonic() + timeout
    last_status: dict | None = None
    while time.monotonic() < deadline:
        try:
            response = httpx.get(f"{base_url}/api/health/migration", timeout=5.0)
            last_status = response.json()
        except httpx.HTTPError as exc:
            last_status = {"status": "unreachable", "error": str(exc)}
        else:
            print(f"migration status: {json.dumps(last_status)}")
            if last_status.get("status") == "complete":
                return 0
            if last_status.get("status") == "failed":
                print(
                    f"Migration failed: {last_status.get('failure_code')}",
                    file=sys.stderr,
                )
                return 1
        time.sleep(poll_interval)

    print(f"Timed out after {timeout}s waiting for migration to complete: "
          f"{last_status}", file=sys.stderr)
    return 1


def check_postconditions(database_url: str, manifest_path: Path, expect: str) -> int:
    manifest = json.loads(manifest_path.read_text())
    expected = manifest[expect]
    engine = create_engine(database_url, future=True)
    ok = True
    try:
        with engine.connect() as conn:
            owned_workspaces = text(
                "SELECT w.id FROM workspaces w JOIN users u ON u.id = w.owner_id "
                "WHERE u.username = ANY(:usernames)"
            )
            workspace_count = conn.execute(
                text(f"SELECT count(*) FROM ({owned_workspaces}) w"),
                {"usernames": manifest["owner_usernames"]},
            ).scalar()
            member_count = conn.execute(
                text(
                    f"SELECT count(*) FROM members "
                    f"WHERE workspace_id IN ({owned_workspaces})"
                ),
                {"usernames": manifest["owner_usernames"]},
            ).scalar()
            identity_link_count = conn.execute(
                text(
                    "SELECT count(*) FROM identity_links "
                    "WHERE member_a_id = ANY(:ids) AND member_b_id = ANY(:ids)"
                ),
                {"ids": manifest["cross_owner_member_ids"]},
            ).scalar()
    finally:
        engine.dispose()

    print(
        f"[{expect}] workspaces={workspace_count}, members={member_count}, "
        f"identity_links={identity_link_count}"
    )

    if workspace_count != expected["workspace_count"]:
        print(
            f"expected {expected['workspace_count']} workspaces, "
            f"found {workspace_count}",
            file=sys.stderr,
        )
        ok = False
    if member_count != expected["member_count"]:
        print(
            f"expected {expected['member_count']} members, "
            f"found {member_count}",
            file=sys.stderr,
        )
        ok = False
    if identity_link_count != expected["identity_link_count"]:
        print(
            f"expected {expected['identity_link_count']} identity links "
            f"between the cross-owner pair, found {identity_link_count}",
            file=sys.stderr,
        )
        ok = False

    return 0 if ok else 1


def assert_single_run(database_url: str) -> int:
    engine = create_engine(database_url, future=True)
    try:
        with engine.connect() as conn:
            run_count = conn.execute(
                text("SELECT count(*) FROM migration_runs")
            ).scalar()
            statuses = (
                conn.execute(text("SELECT status FROM migration_runs")).scalars().all()
            )
    finally:
        engine.dispose()

    print(f"migration_runs: count={run_count}, statuses={statuses}")
    if run_count != 1:
        print(
            "expected exactly one migration run (a restart must not "
            f"re-trigger the conversion); found {run_count}",
            file=sys.stderr,
        )
        return 1
    if statuses[0] != "complete":
        print(
            f"expected the sole run to stay 'complete', found {statuses[0]!r}",
            file=sys.stderr,
        )
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    wait_parser = subparsers.add_parser("wait-for-migration")
    wait_parser.add_argument("--base-url", required=True)
    wait_parser.add_argument("--timeout", type=float, default=300.0)
    wait_parser.add_argument("--poll-interval", type=float, default=3.0)

    post_parser = subparsers.add_parser("check-postconditions")
    post_parser.add_argument("--database-url", required=True)
    post_parser.add_argument("--manifest", type=Path, required=True)
    post_parser.add_argument(
        "--expect",
        choices=["pre_conversion", "post_conversion"],
        default="post_conversion",
    )

    single_run_parser = subparsers.add_parser("assert-single-run")
    single_run_parser.add_argument("--database-url", required=True)

    args = parser.parse_args()

    if args.command == "wait-for-migration":
        return wait_for_migration(args.base_url, args.timeout, args.poll_interval)
    if args.command == "check-postconditions":
        return check_postconditions(args.database_url, args.manifest, args.expect)
    if args.command == "assert-single-run":
        return assert_single_run(args.database_url)
    raise AssertionError(f"unhandled command {args.command!r}")


if __name__ == "__main__":
    raise SystemExit(main())
