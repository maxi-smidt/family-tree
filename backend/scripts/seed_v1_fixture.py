"""Seed a representative pre-v2 (v1.x) fixture for the packaged upgrade
rehearsal (#1022).

``tests/test_migration_postgres.py`` already proves the v1 -> v2 data
conversion is correct against a real Postgres database, but it runs the
conversion in-process against the *source* checkout — never against the
actual built container image a self-hoster would pull. This script seeds the
same kind of legacy-shaped data that test relies on (``V1Seed``) into a
database reachable from the host, so the release workflow can point the
*packaged* backend image at it and watch the real automatic migration run.

The scenario is deliberately small (a solo tree, one same-owner bridge pair
that must merge, one cross-owner bridge pair that must not) — just enough to
exercise every phase and postcondition once through the packaged image. The
broader same-owner/cross-owner/dangling/asymmetric matrix, and a second
fixture at the oldest supported revision, already have (or are left for)
coverage elsewhere; re-deriving all of it here would only slow the release
pipeline down for no new signal — see ``tests/test_migration_postgres.py``.

Run against a disposable Postgres database only:

    uv run python -m scripts.seed_v1_fixture \\
        --database-url postgresql+psycopg2://familytree:familytree@localhost:5433/ft \\
        --manifest-out manifest.json
"""

from __future__ import annotations

import argparse
import json
import uuid
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import MetaData, create_engine
from sqlalchemy.engine import Connection

from app.core.config import settings
from app.core.security import hash_password
from app.db.base import utcnow_iso

BACKEND_DIR = Path(__file__).resolve().parents[1]

# The last revision before the v2 chain starts (see `alembic history`) — a
# v1.x database always sits here or earlier. Chosen over the literal
# `v1_0_0_baseline` because the tree-linking feature this fixture exercises
# (`members.linked_tree_id`/`linked_member_id`) was only added in v1.5.0; an
# actual v1.0.0 install couldn't have this data. Docs still call rebasing an
# older/unknown revision onto `v1_0_0_baseline` "supported" (see
# `app.db.init_db._stored_revision_is_unknown`) — that rebase itself has no
# rehearsal coverage yet, since it seeds no data of its own.
LATEST_V1_REVISION = "v1_10_0_remove_feature_flags"


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _upgrade_to(database_url: str, revision: str) -> None:
    # alembic/env.py reads settings.DATABASE_URL as its source of truth (see
    # tests/test_migration_postgres.py for the same pattern).
    previous = settings.DATABASE_URL
    settings.DATABASE_URL = database_url
    try:
        command.upgrade(_alembic_config(), revision)
    finally:
        settings.DATABASE_URL = previous


class V1Fixture:
    """Inserts directly against the tables as they stand at ``--revision`` —
    still named ``trees``/``tree_id`` (the v2 rename hasn't run yet).

    Mirrors ``tests.test_migration_postgres.V1Seed``, adapted to a pre-rename
    revision: the ORM models always reflect the head (v2) schema, so they
    can't insert a not-yet-migrated row.
    """

    def __init__(self, conn: Connection) -> None:
        self._conn = conn
        meta = MetaData()
        meta.reflect(
            bind=conn.engine,
            only=[
                "users",
                "trees",
                "members",
                "tree_memberships",
                "virtual_views",
                "virtual_view_sources",
                "virtual_view_member_matches",
            ],
        )
        self._users = meta.tables["users"]
        self._trees = meta.tables["trees"]
        self._members = meta.tables["members"]
        self._tree_memberships = meta.tables["tree_memberships"]
        self._virtual_views = meta.tables["virtual_views"]
        self._virtual_view_sources = meta.tables["virtual_view_sources"]
        self._virtual_view_member_matches = meta.tables["virtual_view_member_matches"]

    def user(
        self, username: str, password: str | None = None, *, is_admin: bool = False
    ) -> str:
        user_id = str(uuid.uuid4())
        self._conn.execute(
            self._users.insert().values(
                id=user_id,
                username=username,
                hashed_password=hash_password(password) if password else None,
                is_admin=is_admin,
                is_active=True,
                auth_provider="local",
                created_at=utcnow_iso(),
            )
        )
        return user_id

    def tree(
        self,
        owner_id: str,
        name: str,
        *,
        public_password: str | None = None,
    ) -> str:
        """``public_password`` implies ``public_role="viewer"`` — a v1 tree
        can only be password-protected while publicly shared."""
        tree_id = str(uuid.uuid4())
        self._conn.execute(
            self._trees.insert().values(
                id=tree_id,
                name=name,
                owner_id=owner_id,
                created_at=utcnow_iso(),
                public_role="viewer" if public_password else None,
                public_password_hash=hash_password(public_password)
                if public_password
                else None,
            )
        )
        return tree_id

    def member(self, tree_id: str, member_id: str, **fields: object) -> None:
        self._conn.execute(
            self._members.insert().values(
                id=member_id,
                tree_id=tree_id,
                is_collapsed=False,
                position_x=0.0,
                position_y=0.0,
                **fields,
            )
        )

    def bridge(self, member_id: str, linked_tree_id: str, linked_member_id: str) -> None:
        self._conn.execute(
            self._members.update()
            .where(self._members.c.id == member_id)
            .values(linked_tree_id=linked_tree_id, linked_member_id=linked_member_id)
        )

    def share(
        self,
        tree_id: str,
        user_id: str,
        role: str = "viewer",
        restrictions: list[str] | None = None,
    ) -> None:
        self._conn.execute(
            self._tree_memberships.insert().values(
                tree_id=tree_id, user_id=user_id, role=role, restrictions=restrictions
            )
        )

    def virtual_view(
        self, view_id: str, owner_id: str, name: str, source_tree_ids: list[str]
    ) -> None:
        self._conn.execute(
            self._virtual_views.insert().values(
                id=view_id, name=name, owner_id=owner_id, created_at=utcnow_iso()
            )
        )
        self._conn.execute(
            self._virtual_view_sources.insert(),
            [
                {"view_id": view_id, "position": i, "tree_id": tree_id}
                for i, tree_id in enumerate(source_tree_ids)
            ],
        )

    def virtual_view_match(
        self, view_id: str, group_id: str, member_id: str, is_primary: bool = False
    ) -> None:
        self._conn.execute(
            self._virtual_view_member_matches.insert().values(
                view_id=view_id,
                member_id=member_id,
                group_id=group_id,
                is_primary=is_primary,
            )
        )


def build_fixture(database_url: str, revision: str) -> dict:
    """Seed the fixture and return the manifest the verifier checks the
    packaged migration against."""
    _upgrade_to(database_url, revision)

    engine = create_engine(database_url, future=True)
    try:
        with engine.begin() as conn:
            seed = V1Fixture(conn)

            owner1 = seed.user("rehearsal-owner1")
            owner2 = seed.user("rehearsal-owner2")

            # An ordinary, unlinked single tree — must survive untouched.
            solo = seed.tree(owner1, "Rehearsal Solo")
            seed.member(solo, "rehearsal-solo-m1")
            seed.member(solo, "rehearsal-solo-m2")

            # Same-owner mutual bridge: the two trees must merge into one
            # workspace, and the bridged member pair must collapse into one row.
            left = seed.tree(owner1, "Rehearsal Left")
            right = seed.tree(owner1, "Rehearsal Right")
            seed.member(left, "rehearsal-left-a")
            seed.member(right, "rehearsal-right-a")
            seed.bridge("rehearsal-left-a", right, "rehearsal-right-a")
            seed.bridge("rehearsal-right-a", left, "rehearsal-left-a")

            # Cross-owner mutual bridge: both trees and both members must
            # survive separately, linked by one IdentityLink row.
            cross_a = seed.tree(owner1, "Rehearsal CrossA")
            cross_b = seed.tree(owner2, "Rehearsal CrossB")
            seed.member(cross_a, "rehearsal-cross-a1")
            seed.member(cross_b, "rehearsal-cross-b1")
            seed.bridge("rehearsal-cross-a1", cross_b, "rehearsal-cross-b1")
            seed.bridge("rehearsal-cross-b1", cross_a, "rehearsal-cross-a1")
    finally:
        engine.dispose()

    return {
        "revision": revision,
        "owner_usernames": ["rehearsal-owner1", "rehearsal-owner2"],
        "cross_owner_member_ids": ["rehearsal-cross-a1", "rehearsal-cross-b1"],
        # The automatic `pre_migration` backup is taken right after the
        # schema-only migration but *before* the orchestrator's CONVERTING
        # phase runs (see docs/UPGRADE_V2.md #6/#8) — restoring it into a
        # blank target must reproduce these still-unmerged counts, not the
        # converged ones. The `v2_0_0_identity_links` schema migration
        # itself already turns every live bridge pointer into an
        # IdentityLink row (including the same-owner pair that CONVERTING
        # will later collapse into one member), so this is 1, not 0.
        "pre_conversion": {
            "workspace_count": 5,  # solo, left, right, crossA, crossB
            "member_count": 6,
            "identity_link_count": 1,
        },
        # solo(1) + merged(left+right)(1) + crossA(1) + crossB(1) workspaces;
        # solo(2) + merged bridge pair(1, collapsed) + crossA(1) + crossB(1)
        # members; only the cross-owner pair keeps two members linked
        # instead of merging them.
        "post_conversion": {
            "workspace_count": 4,
            "member_count": 5,
            "identity_link_count": 1,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        required=True,
        help="SQLAlchemy URL of a blank, disposable Postgres database",
    )
    parser.add_argument("--revision", default=LATEST_V1_REVISION)
    parser.add_argument("--manifest-out", type=Path, default=None)
    args = parser.parse_args()

    manifest = build_fixture(args.database_url, args.revision)
    rendered = json.dumps(manifest, indent=2)
    if args.manifest_out:
        args.manifest_out.write_text(rendered + "\n")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
