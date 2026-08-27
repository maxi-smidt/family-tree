"""Defer the identity_links member FKs (#998).

``app.services.migration.converter._prepare_bridge_collapses`` repoints an
identity link's ``workspace_a_id``/``workspace_b_id`` onto the survivor
*before* ``_repoint_content`` moves that member's own row onto the same
workspace (its docstring explains why: doing it after would instead leave a
stale link pointing at the member's old, about-to-be-vacated workspace, which
breaks the composite FK from the other direction). Either order leaves a
single flush where the identity link and its member briefly disagree — fine
once both sides land in the same transaction, fatal as an immediately-checked
constraint. That never showed up against a simple two-workspace bridge pair
(the link's *other* side is already the survivor, so it's deleted outright
instead of repointed — see ``_prepare_bridge_collapses``), only once a
same-owner component chains three or more linked workspaces together, so a
link can still name a third, not-yet-absorbed workspace at flush time.

Deferring these two FKs to transaction-commit time (matching
``run_conversion``'s own per-source ``UnitOfWork`` boundary, by which point
every member of that source has already moved) fixes it with no change to
the conversion logic itself.

Revision ID: v2_0_0_defer_identity_link_fks
Revises: v2_0_0_widen_run_source_version
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "v2_0_0_defer_identity_link_fks"
down_revision: Union[str, None] = "v2_0_0_widen_run_source_version"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINTS = ("fk_identity_link_member_a", "fk_identity_link_member_b")


def upgrade() -> None:
    for name in _CONSTRAINTS:
        op.execute(
            f"ALTER TABLE identity_links ALTER CONSTRAINT {name} "
            "DEFERRABLE INITIALLY DEFERRED"
        )


def downgrade() -> None:
    for name in _CONSTRAINTS:
        op.execute(f"ALTER TABLE identity_links ALTER CONSTRAINT {name} NOT DEFERRABLE")
