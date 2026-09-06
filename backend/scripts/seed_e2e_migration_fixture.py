"""Seed a v1.x fixture that exercises the *user-visible* v2 migration surface
for Playwright (#992): the migration report/review UI, section-scoped grants
created from consolidation, and section-scoped public links.

This is deliberately a separate fixture from ``seed_v1_fixture`` (#1022's
packaged-upgrade rehearsal): that one is scoped tightly to what
``scripts.verify_upgrade_rehearsal`` checks against Postgres row counts, and
changing its shape would need re-deriving those counts for no UI-testing
benefit. This fixture instead needs signed-in-capable users (a password) and
enough of a same-owner merge to produce every report section the review UI
renders — workspace mappings, scoped grants with differing roles/
restrictions, scoped public links, a converted saved view, a dropped view,
and a pending "duplicate person" conflict.

Scenario (owner "e2e-migrated-owner1"):

- ``Solo`` — untouched, single tree/workspace (regression check).
- ``Left`` (3 members), ``Right`` (2 members), ``Extra`` (1 member) — all
  three merge into one workspace via same-owner bridges. ``Left`` has the
  most members, so it becomes the survivor (the merged workspace keeps its
  name); ``Right`` and ``Extra`` each become a section.
  - ``Left``/``Right``'s bridged pair has drifting names, producing a
    pending "duplicate person" (BRIDGE_MERGE) conflict.
  - ``Left``/``Extra``'s bridged pair matches exactly (clean merge, no
    conflict) — this is what unions ``Extra`` into the same final workspace
    as ``Left``/``Right``.
  - The collaborator "e2e-migrated-collab" is shared on ``Left`` (viewer,
    gallery restricted) and on ``Right`` (editor, unrestricted) — migration
    turns each into its own ``WorkspaceSectionGrant``, so the same person
    ends up with two different roles/restrictions in one workspace.
  - ``Right`` and ``Extra`` are each publicly shared with their own
    password — migration turns each into its own
    ``WorkspaceSectionPublicLink``, independently passworded.
- A virtual view spanning ``Left``+``Right`` (same final workspace) converts
  to a saved view and carries a member-match group, producing a pending
  "possible match" (VIRTUAL_VIEW_MATCH) conflict.
- A virtual view spanning ``Solo``+``CrossA`` (different final workspaces)
  is dropped.
- ``CrossA`` (owner1) / ``CrossB`` (owner2) are cross-owner bridged, so they
  stay as two separate workspaces linked by an ``IdentityLink`` — mainly here
  so a second owner exists to check migration reports never leak across
  owners.

Run against a disposable Postgres database only:

    uv run python -m scripts.seed_e2e_migration_fixture \\
        --database-url postgresql+psycopg2://familytree:familytree@localhost:5434/familytree
"""

from __future__ import annotations

import argparse
import os

from sqlalchemy import create_engine

from scripts.seed_v1_fixture import LATEST_V1_REVISION, V1Fixture, _upgrade_to

# Matches e2e/fixtures/users.ts's ADMIN_USERNAME/PASSWORD defaults: the e2e
# harness's global setup logs in as this account (to disable the legal-
# acceptance gate) regardless of which stack it's pointed at, and
# `_seed_admin` (app/db/init_db.py) only bootstraps FIRST_ADMIN_* when the
# database has zero users — already false here — so this fixture has to
# provide its own admin instead of relying on that bootstrap.
ADMIN_USERNAME = os.environ.get("E2E_ADMIN_USERNAME", "e2e-admin")
ADMIN_PASSWORD = os.environ.get("E2E_ADMIN_PASSWORD", "e2e-admin-password")

# Mirrored in e2e/fixtures/migrated.ts — keep both in sync.
OWNER1_USERNAME = "e2e-migrated-owner1"
OWNER1_PASSWORD = "e2e-migrated-owner1-pw"
OWNER2_USERNAME = "e2e-migrated-owner2"
OWNER2_PASSWORD = "e2e-migrated-owner2-pw"
COLLABORATOR_USERNAME = "e2e-migrated-collab"
COLLABORATOR_PASSWORD = "e2e-migrated-collab-pw"

WORKSPACE_NAME = "E2E Migration Left"  # the survivor: most members (see above)
RIGHT_SECTION_NAME = "E2E Migration Right"
EXTRA_SECTION_NAME = "E2E Migration Extra"
SOLO_WORKSPACE_NAME = "E2E Migration Solo"
CROSS_A_WORKSPACE_NAME = "E2E Migration CrossA"
CROSS_B_WORKSPACE_NAME = "E2E Migration CrossB"
COMBO_VIEW_NAME = "E2E Migration Combo"
DROPPED_VIEW_NAME = "E2E Migration Dropped Combo"

RIGHT_PUBLIC_PASSWORD = "e2e-migration-right-secret"
EXTRA_PUBLIC_PASSWORD = "e2e-migration-extra-secret"

LEFT_A_NAME = "Anna"
RIGHT_A_NAME = "Anne"  # drifts from LEFT_A_NAME -> pending bridge-merge conflict


def build_fixture(database_url: str, revision: str) -> None:
    _upgrade_to(database_url, revision)

    engine = create_engine(database_url, future=True)
    try:
        with engine.begin() as conn:
            seed = V1Fixture(conn)

            seed.user(ADMIN_USERNAME, ADMIN_PASSWORD, is_admin=True)
            owner1 = seed.user(OWNER1_USERNAME, OWNER1_PASSWORD)
            owner2 = seed.user(OWNER2_USERNAME, OWNER2_PASSWORD)
            collaborator = seed.user(COLLABORATOR_USERNAME, COLLABORATOR_PASSWORD)

            # An ordinary, unlinked single tree — must survive untouched.
            solo = seed.tree(owner1, SOLO_WORKSPACE_NAME)
            seed.member(solo, "e2e-mig-solo-1", first_name="Solo", last_name="One")
            seed.member(solo, "e2e-mig-solo-2", first_name="Solo", last_name="Two")

            # Left/Right/Extra: three same-owner trees that merge into one
            # workspace via a chain of mutual bridges (Left<->Right,
            # Left<->Extra). Left has the most members, so it survives.
            left = seed.tree(owner1, WORKSPACE_NAME)
            right = seed.tree(
                owner1, RIGHT_SECTION_NAME, public_password=RIGHT_PUBLIC_PASSWORD
            )
            extra = seed.tree(
                owner1, EXTRA_SECTION_NAME, public_password=EXTRA_PUBLIC_PASSWORD
            )

            seed.member(
                left, "e2e-mig-left-a", first_name=LEFT_A_NAME, last_name="Bridge"
            )
            seed.member(left, "e2e-mig-left-b", first_name="Priya", last_name="Boundary")
            seed.member(left, "e2e-mig-left-c", first_name="Cara", last_name="Clean")
            seed.member(
                right, "e2e-mig-right-a", first_name=RIGHT_A_NAME, last_name="Bridge"
            )
            seed.member(
                right, "e2e-mig-right-b", first_name="Priya", last_name="Boundary"
            )
            seed.member(extra, "e2e-mig-extra-a", first_name="Cara", last_name="Clean")

            # Drifting names -> pending "duplicate person" conflict on merge.
            seed.bridge("e2e-mig-left-a", right, "e2e-mig-right-a")
            seed.bridge("e2e-mig-right-a", left, "e2e-mig-left-a")
            # Identical fields -> clean merge; unions Extra into the same
            # final workspace as Left/Right.
            seed.bridge("e2e-mig-left-c", extra, "e2e-mig-extra-a")
            seed.bridge("e2e-mig-extra-a", left, "e2e-mig-left-c")

            # Collaborator: different role/restrictions per source tree ->
            # two distinct WorkspaceSectionGrants in the merged workspace.
            seed.share(left, collaborator, role="viewer", restrictions=["gallery"])
            seed.share(right, collaborator, role="editor")

            # Cross-owner mutual bridge: both trees and both members survive
            # separately, linked by one IdentityLink row (not merged).
            cross_a = seed.tree(owner1, CROSS_A_WORKSPACE_NAME)
            cross_b = seed.tree(owner2, CROSS_B_WORKSPACE_NAME)
            seed.member(cross_a, "e2e-mig-cross-a1")
            seed.member(cross_b, "e2e-mig-cross-b1")
            seed.bridge("e2e-mig-cross-a1", cross_b, "e2e-mig-cross-b1")
            seed.bridge("e2e-mig-cross-b1", cross_a, "e2e-mig-cross-a1")

            # Converts to a saved view (Left+Right land in the same final
            # workspace) and carries a match group -> pending "possible
            # match" conflict between left-b and right-b.
            seed.virtual_view(
                "e2e-mig-view-combo", owner1, COMBO_VIEW_NAME, [left, right]
            )
            seed.virtual_view_match(
                "e2e-mig-view-combo",
                "e2e-mig-match-1",
                "e2e-mig-left-b",
                is_primary=True,
            )
            seed.virtual_view_match(
                "e2e-mig-view-combo", "e2e-mig-match-1", "e2e-mig-right-b"
            )

            # Dropped: Solo and CrossA never merge, so this view spans two
            # different final workspaces.
            seed.virtual_view(
                "e2e-mig-view-dropped", owner1, DROPPED_VIEW_NAME, [solo, cross_a]
            )
    finally:
        engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        required=True,
        help="SQLAlchemy URL of a blank, disposable Postgres database",
    )
    parser.add_argument("--revision", default=LATEST_V1_REVISION)
    args = parser.parse_args()

    build_fixture(args.database_url, args.revision)
    print("Seeded the e2e v1->v2 migration fixture.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
