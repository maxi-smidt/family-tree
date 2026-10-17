"""v2.0.0 schema: workspaces, sections, scoped sharing, identity links, saved
views, and v1 -> v2 migration bookkeeping.

One revision for the whole v1.10 -> v2.0 schema change, squashed from the
sixteen revisions that built it up during v2 development (#982, #983, #985,
#986, #992, #993, #997, #998, #1012, #1014, #1018, #1023, #1024). In order:

1. Rename trees to workspaces and every ``tree_id`` to ``workspace_id``
   (``_rename_schema``; also reused by the v1 backup adapter).
2. Sections, section membership, and per-section layout.
3. Relation traversal indexes for the neighborhood API.
4. Content provenance scopes, seeded workspace-wide for existing content.
5. Section-scoped grants, public links, and invitation scope.
6. Identity links, replacing the tree-in-tree bridge. Every existing bridge
   pair (``Member.linked_member_id``) is converted into a verified
   ``identity_links`` row (``migrate_legacy_bridges_to_identity_links``; also
   reused by the v1 backup adapter). The legacy ``linked_workspace_id`` /
   ``linked_member_id`` columns are left untouched here; the app-level
   startup migration drops them once conversion is finalized (#1021).
7. Saved views: config, section filter, layout overlay, per-user state.
8. Durable v2 migration state: runs, mappings, reports, conflicts.
9. ``Member.name_normalized`` and a trigram index for workspace search.
10. Identity link claims.

Every ``upgrade()`` step is additive or a rename; nothing is dropped until
``downgrade()`` (see ``app.services.migration.orchestrator``).

Revision ID: v2_0_0_workspaces
Revises: v1_10_0_remove_feature_flags
Create Date: 2026-10-17 00:00:00.000000

"""

import json
import uuid
from datetime import UTC, datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_workspaces"
down_revision: Union[str, None] = "v1_10_0_remove_feature_flags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# 1. trees -> workspaces
# ---------------------------------------------------------------------------

TABLE_RENAMES = (
    ("trees", "workspaces"),
    ("tree_memberships", "workspace_memberships"),
    ("tree_user_states", "workspace_user_states"),
    ("tree_invitations", "workspace_invitations"),
)

COLUMN_RENAMES = (
    ("background_jobs", "result_tree_id", "result_workspace_id"),
    ("activity_log", "tree_id", "workspace_id"),
    ("events", "tree_id", "workspace_id"),
    ("gallery_images", "tree_id", "workspace_id"),
    ("members", "tree_id", "workspace_id"),
    ("members", "linked_tree_id", "linked_workspace_id"),
    ("stories", "tree_id", "workspace_id"),
    ("virtual_view_sources", "tree_id", "workspace_id"),
    ("quality_issue_dismissals", "tree_id", "workspace_id"),
    ("documents", "tree_id", "workspace_id"),
    ("document_files", "tree_id", "workspace_id"),
    ("document_uploads", "tree_id", "workspace_id"),
    ("member_tasks", "tree_id", "workspace_id"),
    ("member_diseases", "tree_id", "workspace_id"),
    ("relations", "tree_id", "workspace_id"),
    ("workspace_user_states", "tree_id", "workspace_id"),
    ("workspace_invitations", "tree_id", "workspace_id"),
    ("workspace_memberships", "tree_id", "workspace_id"),
)

INDEX_RENAMES = (
    ("ix_trees_owner_id", "ix_workspaces_owner_id"),
    ("ix_tree_invitations_token", "ix_workspace_invitations_token"),
    ("ix_tree_invitations_tree_id", "ix_workspace_invitations_workspace_id"),
    ("ix_activity_log_tree_id", "ix_activity_log_workspace_id"),
    ("ix_events_tree_id", "ix_events_workspace_id"),
    ("ix_gallery_images_tree_id", "ix_gallery_images_workspace_id"),
    ("ix_members_tree_id", "ix_members_workspace_id"),
    ("ix_members_linked_tree_id", "ix_members_linked_workspace_id"),
    ("ix_stories_tree_id", "ix_stories_workspace_id"),
    ("ix_quality_issue_dismissals_tree_id", "ix_quality_issue_dismissals_workspace_id"),
    ("ix_documents_tree_id", "ix_documents_workspace_id"),
    ("ix_document_files_tree_id", "ix_document_files_workspace_id"),
    ("ix_document_files_tree_id_url", "ix_document_files_workspace_id_url"),
    ("ix_document_uploads_tree_id", "ix_document_uploads_workspace_id"),
    ("ix_member_tasks_tree_id", "ix_member_tasks_workspace_id"),
    ("ix_member_diseases_tree_id", "ix_member_diseases_workspace_id"),
)

CONSTRAINT_RENAMES = (
    ("members", "fk_members_linked_tree_id_trees", "fk_members_linked_workspace_id_workspaces"),
    ("quality_issue_dismissals", "uq_quality_dismissal_tree_issue", "uq_quality_dismissal_workspace_issue"),
)


def _rename_schema() -> None:
    for old_name, new_name in TABLE_RENAMES:
        op.rename_table(old_name, new_name)

    for table, old_name, new_name in COLUMN_RENAMES:
        op.alter_column(table, old_name, new_column_name=new_name)

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table, old_name, new_name in CONSTRAINT_RENAMES:
            op.execute(
                sa.text(
                    f'ALTER TABLE "{table}" RENAME CONSTRAINT "{old_name}" TO "{new_name}"'
                )
            )

        for old_name, new_name in INDEX_RENAMES:
            op.execute(sa.text(f'ALTER INDEX "{old_name}" RENAME TO "{new_name}"'))


def _restore_schema() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for old_name, new_name in reversed(INDEX_RENAMES):
            op.execute(sa.text(f'ALTER INDEX "{new_name}" RENAME TO "{old_name}"'))

        for table, old_name, new_name in reversed(CONSTRAINT_RENAMES):
            op.execute(
                sa.text(
                    f'ALTER TABLE "{table}" RENAME CONSTRAINT "{new_name}" TO "{old_name}"'
                )
            )

    for table, old_name, new_name in reversed(COLUMN_RENAMES):
        op.alter_column(table, new_name, new_column_name=old_name)

    for old_name, new_name in reversed(TABLE_RENAMES):
        op.rename_table(new_name, old_name)


# ---------------------------------------------------------------------------
# 2. Sections
# ---------------------------------------------------------------------------


def _create_sections() -> None:
    op.create_table(
        "sections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("name_normalized", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "name_normalized", name="uq_section_workspace_name"
        ),
        # Parent key for the composite FKs below, so the database can reject a
        # scope/grant/view whose section belongs to a different workspace.
        sa.UniqueConstraint("workspace_id", "id", name="uq_section_workspace_id_id"),
    )
    op.create_index(
        op.f("ix_sections_workspace_id"), "sections", ["workspace_id"], unique=False
    )

    op.create_table(
        "section_members",
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("section_id", "member_id"),
    )
    op.create_index(
        op.f("ix_section_members_member_id"),
        "section_members",
        ["member_id"],
        unique=False,
    )

    op.create_table(
        "section_positions",
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("section_id", "member_id"),
    )


def _drop_sections() -> None:
    op.drop_table("section_positions")
    op.drop_index(op.f("ix_section_members_member_id"), table_name="section_members")
    op.drop_table("section_members")
    op.drop_index(op.f("ix_sections_workspace_id"), table_name="sections")
    op.drop_table("sections")


# ---------------------------------------------------------------------------
# 3. Relation traversal indexes
# ---------------------------------------------------------------------------


def _create_relation_indexes() -> None:
    # Built non-concurrently, so each takes a SHARE lock on ``relations`` for
    # the duration. Migrations run at container start before the app serves
    # traffic, so this only stalls writes from another replica mid-deploy.
    op.create_index(
        "ix_relations_workspace_type_from",
        "relations",
        ["workspace_id", "relation_type", "from_member_id"],
        unique=False,
    )
    op.create_index(
        "ix_relations_workspace_type_to",
        "relations",
        ["workspace_id", "relation_type", "to_member_id"],
        unique=False,
    )


def _drop_relation_indexes() -> None:
    op.drop_index("ix_relations_workspace_type_to", table_name="relations")
    op.drop_index("ix_relations_workspace_type_from", table_name="relations")


# ---------------------------------------------------------------------------
# 4. Content provenance scopes
# ---------------------------------------------------------------------------

# (content type, table). Every content domain that carries an independent
# origin scope; anything else inherits its audience from a parent row.
CONTENT_TABLES: tuple[tuple[str, str], ...] = (
    ("event", "events"),
    ("story", "stories"),
    ("document", "documents"),
    ("gallery_image", "gallery_images"),
    ("task", "member_tasks"),
    ("disease", "member_diseases"),
)

# member_diseases has no created_at column of its own.
SEEDED_AT = "1970-01-01T00:00:00+00:00"


def _create_content_scopes() -> None:
    op.create_table(
        "content_scopes",
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("content_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("section_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            name="fk_content_scopes_section",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("content_type", "content_id"),
    )
    op.create_index(
        op.f("ix_content_scopes_workspace_id"),
        "content_scopes",
        ["workspace_id"],
        unique=False,
    )
    op.create_index(
        "ix_content_scopes_workspace_id_section_id",
        "content_scopes",
        ["workspace_id", "section_id"],
        unique=False,
    )

    # Seed every existing record as workspace-wide. That is what its audience
    # actually was before provenance existed: no grant could be narrower than
    # the workspace, so nobody's visibility changes here.
    for content_type, table in CONTENT_TABLES:
        created_at = "created_at" if table != "member_diseases" else f"'{SEEDED_AT}'"
        op.execute(
            sa.text(
                f"""
                INSERT INTO content_scopes
                    (content_type, content_id, workspace_id, section_id, created_at)
                SELECT '{content_type}', id, workspace_id, NULL,
                       COALESCE({created_at}, '{SEEDED_AT}')
                FROM {table}
                """  # noqa: S608 - fixed table names from CONTENT_TABLES
            )
        )


def _drop_content_scopes() -> None:
    op.drop_index(
        "ix_content_scopes_workspace_id_section_id", table_name="content_scopes"
    )
    op.drop_index(op.f("ix_content_scopes_workspace_id"), table_name="content_scopes")
    op.drop_table("content_scopes")


# ---------------------------------------------------------------------------
# 5. Section-scoped grants, public links, and invitation scope
# ---------------------------------------------------------------------------


def _create_scoped_grants() -> None:
    # Existing workspace_memberships/Workspace.public_* rows are untouched:
    # they *are* the workspace-wide grant/link every share used before this
    # landed, so no data migration is needed for the common case (#993).
    op.add_column(
        "workspace_invitations",
        sa.Column("section_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_workspace_invitations_section",
        "workspace_invitations",
        "sections",
        ["workspace_id", "section_id"],
        ["workspace_id", "id"],
        ondelete="RESTRICT",
    )

    op.create_table(
        "workspace_section_grants",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("restrictions", sa.JSON(), nullable=True),
        sa.Column("access_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            name="fk_section_grants_section",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "user_id", "section_id", name="uq_section_grant_scope"
        ),
    )
    op.create_index(
        "ix_section_grants_workspace_user",
        "workspace_section_grants",
        ["workspace_id", "user_id"],
    )
    op.create_index(
        op.f("ix_workspace_section_grants_workspace_id"),
        "workspace_section_grants",
        ["workspace_id"],
    )
    op.create_index(
        op.f("ix_workspace_section_grants_user_id"),
        "workspace_section_grants",
        ["user_id"],
    )

    op.create_table(
        "workspace_section_public_links",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("access_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            name="fk_section_public_links_section",
            # RESTRICT (unlike the invitations FK above) is safe here: a
            # row only ever exists while its link is live — revoking one
            # deletes it (see revoke_section_public_link) — so RESTRICT
            # correctly blocks section deletion only while a *live* link
            # still references it.
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_section_public_links_workspace_section",
        "workspace_section_public_links",
        ["workspace_id", "section_id"],
    )
    op.create_index(
        op.f("ix_workspace_section_public_links_workspace_id"),
        "workspace_section_public_links",
        ["workspace_id"],
    )


def _drop_scoped_grants() -> None:
    op.drop_index(
        op.f("ix_workspace_section_public_links_workspace_id"),
        table_name="workspace_section_public_links",
    )
    op.drop_index(
        "ix_section_public_links_workspace_section",
        table_name="workspace_section_public_links",
    )
    op.drop_table("workspace_section_public_links")

    op.drop_index(
        op.f("ix_workspace_section_grants_user_id"),
        table_name="workspace_section_grants",
    )
    op.drop_index(
        op.f("ix_workspace_section_grants_workspace_id"),
        table_name="workspace_section_grants",
    )
    op.drop_index(
        "ix_section_grants_workspace_user", table_name="workspace_section_grants"
    )
    op.drop_table("workspace_section_grants")

    op.drop_constraint(
        "fk_workspace_invitations_section", "workspace_invitations", type_="foreignkey"
    )
    op.drop_column("workspace_invitations", "section_id")


# ---------------------------------------------------------------------------
# 6. Identity links (#985)
# ---------------------------------------------------------------------------


def migrate_legacy_bridges_to_identity_links(conn: sa.engine.Connection) -> int:
    """Convert every live bridge pair into a verified identity link.

    Each link gets ``verification_basis = "legacy_dual_write_access"`` — it was
    created by one actor with write access to both trees, not necessarily
    approval from both current owners — and each current owner gets a durable
    notification so they can review or unilaterally revoke it.

    A self-join on ``members.linked_member_id`` finds only pairs whose
    counterpart row still exists (a dangling/already-cleared pointer is
    simply skipped), and each unordered pair is only ever converted once
    regardless of which side is scanned first. Returns the number created.
    """
    meta = sa.MetaData()
    meta.reflect(
        bind=conn,
        only=[
            "members",
            "identity_links",
            "identity_link_events",
            "workspaces",
            "notifications",
        ],
    )
    members = meta.tables["members"]
    counterpart = members.alias("counterpart")
    links = meta.tables["identity_links"]
    events = meta.tables["identity_link_events"]
    workspaces = meta.tables["workspaces"]
    notifications = meta.tables["notifications"]

    rows = conn.execute(
        sa.select(
            members.c.id,
            members.c.workspace_id,
            counterpart.c.id.label("counterpart_id"),
            counterpart.c.workspace_id.label("counterpart_workspace_id"),
        ).select_from(
            members.join(counterpart, members.c.linked_member_id == counterpart.c.id)
        )
    ).all()

    now = datetime.now(UTC).isoformat()
    seen_pairs: set[tuple[str, str]] = set()
    notified_owners: set[tuple[str, str]] = set()  # (identity_link_id, owner_id)
    created = 0

    for row in rows:
        a_id, b_id = sorted((row.id, row.counterpart_id))
        if (a_id, b_id) in seen_pairs:
            continue
        seen_pairs.add((a_id, b_id))
        workspace_a_id = (
            row.workspace_id if a_id == row.id else row.counterpart_workspace_id
        )
        workspace_b_id = (
            row.counterpart_workspace_id if a_id == row.id else row.workspace_id
        )

        link_id = str(uuid.uuid4())
        conn.execute(
            links.insert().values(
                id=link_id,
                member_a_id=a_id,
                member_b_id=b_id,
                workspace_a_id=workspace_a_id,
                workspace_b_id=workspace_b_id,
                status="verified",
                verification_basis="legacy_dual_write_access",
                proposed_by=None,
                proposed_at=now,
                expires_at=None,
                approved_by_a=None,
                approved_at_a=now,
                approved_by_b=None,
                approved_at_b=now,
                verified_at=now,
                decided_by=None,
                decided_at=None,
                decision_reason=None,
                version=0,
            )
        )
        created += 1
        conn.execute(
            events.insert().values(
                id=str(uuid.uuid4()),
                identity_link_id=link_id,
                action="migrate",
                actor_id=None,
                from_status=None,
                to_status="verified",
                reason="Migrated from a legacy tree-in-tree bridge",
                created_at=now,
            )
        )

        for workspace_id in (workspace_a_id, workspace_b_id):
            owner_id = conn.execute(
                sa.select(workspaces.c.owner_id, workspaces.c.name).where(
                    workspaces.c.id == workspace_id
                )
            ).first()
            if owner_id is None or (link_id, owner_id.owner_id) in notified_owners:
                continue
            notified_owners.add((link_id, owner_id.owner_id))
            conn.execute(
                notifications.insert().values(
                    id=str(uuid.uuid4()),
                    user_id=owner_id.owner_id,
                    type="identity_link_legacy_migrated",
                    payload=json.dumps(
                        {
                            "identity_link_id": link_id,
                            "workspace_id": workspace_id,
                            "workspace_name": owner_id.name,
                        }
                    ),
                    created_at=now,
                    read_at=None,
                )
            )

    return created


def _create_identity_links() -> None:
    op.create_unique_constraint(
        "uq_member_workspace_id_id", "members", ["workspace_id", "id"]
    )

    op.create_table(
        "identity_links",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("member_a_id", sa.String(length=36), nullable=False),
        sa.Column("member_b_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_a_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_b_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("verification_basis", sa.String(length=30), nullable=False),
        sa.Column("proposed_by", sa.String(length=36), nullable=True),
        sa.Column("proposed_at", sa.String(length=40), nullable=False),
        sa.Column("expires_at", sa.String(length=40), nullable=True),
        sa.Column("approved_by_a", sa.String(length=36), nullable=True),
        sa.Column("approved_at_a", sa.String(length=40), nullable=True),
        sa.Column("approved_by_b", sa.String(length=36), nullable=True),
        sa.Column("approved_at_b", sa.String(length=40), nullable=True),
        sa.Column("verified_at", sa.String(length=40), nullable=True),
        sa.Column("decided_by", sa.String(length=36), nullable=True),
        sa.Column("decided_at", sa.String(length=40), nullable=True),
        sa.Column("decision_reason", sa.String(length=500), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "workspace_a_id <> workspace_b_id", name="ck_identity_link_no_same_workspace"
        ),
        sa.CheckConstraint(
            "member_a_id < member_b_id", name="ck_identity_link_canonical_order"
        ),
        # Deferred to commit time: the v2 converter repoints a link's
        # workspace onto the survivor *before* moving that member's own row
        # there, so the two briefly disagree within one transaction once a
        # same-owner component chains three or more linked workspaces (see
        # app.services.migration.converter._prepare_bridge_collapses).
        sa.ForeignKeyConstraint(
            ["workspace_a_id", "member_a_id"],
            ["members.workspace_id", "members.id"],
            name="fk_identity_link_member_a",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_b_id", "member_b_id"],
            ["members.workspace_id", "members.id"],
            name="fk_identity_link_member_b",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(["proposed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["approved_by_a"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["approved_by_b"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("member_a_id", "member_b_id", name="uq_identity_link_pair"),
    )
    op.create_index("ix_identity_links_member_a_id", "identity_links", ["member_a_id"])
    op.create_index("ix_identity_links_member_b_id", "identity_links", ["member_b_id"])
    op.create_index("ix_identity_links_workspace_a", "identity_links", ["workspace_a_id"])
    op.create_index("ix_identity_links_workspace_b", "identity_links", ["workspace_b_id"])

    op.create_table(
        "identity_link_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("identity_link_id", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("actor_id", sa.String(length=36), nullable=True),
        sa.Column("from_status", sa.String(length=20), nullable=True),
        sa.Column("to_status", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(
            ["identity_link_id"], ["identity_links.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_identity_link_events_identity_link_id",
        "identity_link_events",
        ["identity_link_id"],
    )
    op.create_index(
        "ix_identity_link_events_created_at", "identity_link_events", ["created_at"]
    )

    op.create_table(
        "identity_link_blocks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("blocked_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blocked_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "blocked_user_id", name="uq_identity_link_block"
        ),
    )
    op.create_index(
        "ix_identity_link_blocks_workspace_id", "identity_link_blocks", ["workspace_id"]
    )
    op.create_index(
        "ix_identity_link_blocks_blocked_user_id",
        "identity_link_blocks",
        ["blocked_user_id"],
    )

    op.create_table(
        "identity_link_idempotency_keys",
        sa.Column("actor_id", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("identity_link_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["identity_link_id"], ["identity_links.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("actor_id", "action", "key"),
    )

    migrate_legacy_bridges_to_identity_links(op.get_bind())


def _drop_identity_links() -> None:
    op.drop_table("identity_link_idempotency_keys")

    op.drop_index(
        "ix_identity_link_blocks_blocked_user_id", table_name="identity_link_blocks"
    )
    op.drop_index(
        "ix_identity_link_blocks_workspace_id", table_name="identity_link_blocks"
    )
    op.drop_table("identity_link_blocks")

    op.drop_index("ix_identity_link_events_created_at", table_name="identity_link_events")
    op.drop_index(
        "ix_identity_link_events_identity_link_id", table_name="identity_link_events"
    )
    op.drop_table("identity_link_events")

    op.drop_index("ix_identity_links_workspace_b", table_name="identity_links")
    op.drop_index("ix_identity_links_workspace_a", table_name="identity_links")
    op.drop_index("ix_identity_links_member_b_id", table_name="identity_links")
    op.drop_index("ix_identity_links_member_a_id", table_name="identity_links")
    op.drop_table("identity_links")

    op.drop_constraint("uq_member_workspace_id_id", "members", type_="unique")


# ---------------------------------------------------------------------------
# 7. Saved views (#986)
# ---------------------------------------------------------------------------


def _create_saved_views() -> None:
    op.create_table(
        "saved_views",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("owner_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("focus_member_id", sa.String(length=36), nullable=True),
        sa.Column("ancestor_depth", sa.Integer(), nullable=False),
        sa.Column("descendant_depth", sa.Integer(), nullable=False),
        sa.Column(
            "include_partners",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column("config_version", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "focus_member_id"],
            ["members.workspace_id", "members.id"],
            ondelete="RESTRICT",
            name="fk_saved_views_focus_member",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "id", name="uq_saved_view_workspace_id_id"
        ),
    )
    op.create_index(
        op.f("ix_saved_views_workspace_id"), "saved_views", ["workspace_id"], unique=False
    )
    op.create_index(
        op.f("ix_saved_views_owner_id"), "saved_views", ["owner_id"], unique=False
    )

    op.create_table(
        "saved_view_sections",
        sa.Column("saved_view_id", sa.String(length=40), nullable=False),
        sa.Column("section_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id", "saved_view_id"],
            ["saved_views.workspace_id", "saved_views.id"],
            ondelete="CASCADE",
            name="fk_saved_view_sections_view",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "section_id"],
            ["sections.workspace_id", "sections.id"],
            ondelete="RESTRICT",
            name="fk_saved_view_sections_section",
        ),
        sa.PrimaryKeyConstraint("saved_view_id", "section_id"),
    )

    op.create_table(
        "saved_view_positions",
        sa.Column("saved_view_id", sa.String(length=40), nullable=False),
        sa.Column("node_id", sa.String(length=40), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(
            ["saved_view_id"], ["saved_views.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("saved_view_id", "node_id"),
    )

    op.create_table(
        "saved_view_user_states",
        sa.Column("saved_view_id", sa.String(length=40), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("last_opened", sa.String(length=40), nullable=False),
        sa.Column("camera_x", sa.Float(), nullable=True),
        sa.Column("camera_y", sa.Float(), nullable=True),
        sa.Column("camera_zoom", sa.Float(), nullable=True),
        sa.Column("collapsed_node_ids", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["saved_view_id"], ["saved_views.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("saved_view_id", "user_id"),
    )


def _drop_saved_views() -> None:
    op.drop_table("saved_view_user_states")
    op.drop_table("saved_view_positions")
    op.drop_table("saved_view_sections")
    op.drop_index(op.f("ix_saved_views_owner_id"), table_name="saved_views")
    op.drop_index(op.f("ix_saved_views_workspace_id"), table_name="saved_views")
    op.drop_table("saved_views")


# ---------------------------------------------------------------------------
# 8. v2 migration state (#997)
# ---------------------------------------------------------------------------


def _create_migration_state() -> None:
    op.create_table(
        "migration_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        # Holds the current Alembic head id(s) when no prior run exists, not
        # just a short semver like target_version's "2.0.0" (#998).
        sa.Column("source_version", sa.String(length=255), nullable=False),
        sa.Column("target_version", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("phase", sa.String(length=20), nullable=False),
        sa.Column("checkpoint", sa.JSON(), nullable=True),
        sa.Column("backup_id", sa.String(length=36), nullable=True),
        sa.Column("backup_path", sa.String(length=500), nullable=True),
        sa.Column("started_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.Column("heartbeat_at", sa.String(length=40), nullable=True),
        sa.Column("completed_at", sa.String(length=40), nullable=True),
        sa.Column("finalized_at", sa.String(length=40), nullable=True),
        sa.Column("finalized_by", sa.String(length=36), nullable=True),
        sa.Column("failure_code", sa.String(length=60), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["finalized_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "migration_mappings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("source_workspace_id", sa.String(length=36), nullable=False),
        sa.Column("source_workspace_name", sa.String(length=255), nullable=False),
        sa.Column("target_workspace_id", sa.String(length=36), nullable=False),
        sa.Column("target_section_id", sa.String(length=36), nullable=True),
        sa.Column("is_survivor", sa.Boolean(), nullable=False),
        sa.Column("tie_break_inputs", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["migration_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "run_id", "source_workspace_id", name="uq_migration_mapping_source"
        ),
    )
    op.create_index(
        "ix_migration_mappings_run_id", "migration_mappings", ["run_id"]
    )
    op.create_index(
        "ix_migration_mappings_target_workspace_id",
        "migration_mappings",
        ["target_workspace_id"],
    )
    # uq_migration_mapping_source (run_id, source_workspace_id) doesn't serve
    # the public legacy-id lookup filtering on source_workspace_id alone
    # across every run (#1012).
    op.create_index(
        "ix_migration_mappings_source_workspace_id",
        "migration_mappings",
        ["source_workspace_id"],
        unique=False,
    )

    op.create_table(
        "migration_reports",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_mappings", sa.JSON(), nullable=False),
        sa.Column("grant_changes", sa.JSON(), nullable=False),
        sa.Column("converted_virtual_views", sa.JSON(), nullable=False),
        sa.Column("dropped_virtual_views", sa.JSON(), nullable=False),
        sa.Column("media_verification", sa.JSON(), nullable=False),
        sa.Column("validation_summary", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("acknowledged_by", sa.String(length=36), nullable=True),
        sa.Column("acknowledged_at", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["migration_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["owner_user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["acknowledged_by"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "owner_user_id", name="uq_migration_report_owner"),
    )
    op.create_index(
        "ix_migration_reports_owner_user_id", "migration_reports", ["owner_user_id"]
    )

    op.create_table(
        "migration_conflicts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("source_section_id", sa.String(length=36), nullable=True),
        sa.Column("member_a_id", sa.String(length=36), nullable=False),
        sa.Column("member_b_id", sa.String(length=36), nullable=False),
        sa.Column("conflicting_fields", sa.JSON(), nullable=False),
        sa.Column("conflicting_media", sa.JSON(), nullable=False),
        sa.Column("blocks_finalization", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("resolution", sa.JSON(), nullable=True),
        sa.Column("resolved_by", sa.String(length=36), nullable=True),
        sa.Column("resolved_at", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        # Bridge-drift field/photo values, so a "merge" resolution has a
        # value to apply once the non-canonical row is gone (#1018).
        sa.Column("canonical_member_id", sa.String(length=36), nullable=True),
        sa.Column("field_values", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["migration_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["owner_user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "run_id",
            "kind",
            "member_a_id",
            "member_b_id",
            name="uq_migration_conflict_pair",
        ),
    )
    op.create_index(
        "ix_migration_conflicts_owner_user_id", "migration_conflicts", ["owner_user_id"]
    )
    op.create_index(
        "ix_migration_conflicts_workspace_id", "migration_conflicts", ["workspace_id"]
    )

    op.create_table(
        "migration_idempotency_keys",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("phase", sa.String(length=20), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("target_type", sa.String(length=30), nullable=False),
        # Long enough for a SavedView id ("sv_" + uuid, 39 chars) (#992).
        sa.Column("target_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["migration_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("run_id", "phase", "key"),
    )


def _drop_migration_state() -> None:
    op.drop_table("migration_idempotency_keys")

    op.drop_index("ix_migration_conflicts_workspace_id", table_name="migration_conflicts")
    op.drop_index(
        "ix_migration_conflicts_owner_user_id", table_name="migration_conflicts"
    )
    op.drop_table("migration_conflicts")

    op.drop_index("ix_migration_reports_owner_user_id", table_name="migration_reports")
    op.drop_table("migration_reports")

    op.drop_index(
        "ix_migration_mappings_source_workspace_id", table_name="migration_mappings"
    )
    op.drop_index(
        "ix_migration_mappings_target_workspace_id", table_name="migration_mappings"
    )
    op.drop_index("ix_migration_mappings_run_id", table_name="migration_mappings")
    op.drop_table("migration_mappings")

    op.drop_table("migration_runs")


# ---------------------------------------------------------------------------
# 9. Member name search (#1024)
# ---------------------------------------------------------------------------


def _create_member_name_search() -> None:
    op.add_column(
        "members",
        sa.Column(
            "name_normalized", sa.String(length=800), server_default="", nullable=False
        ),
    )
    # Backfill existing rows from the same three fields the ORM validator
    # derives new ones from (see Member._derive_name_normalized).
    op.execute(
        """
        UPDATE members
        SET name_normalized = lower(trim(concat_ws(' ', first_name, last_name, maiden_name)))
        """
    )
    # pg_trgm ships in the standard postgres/postgres-alpine image (contrib
    # module) — no extra image or package required.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX ix_members_name_normalized_trgm ON members "
        "USING gin (name_normalized gin_trgm_ops)"
    )


def _drop_member_name_search() -> None:
    op.execute("DROP INDEX IF EXISTS ix_members_name_normalized_trgm")
    op.drop_column("members", "name_normalized")


# ---------------------------------------------------------------------------
# 10. Identity link claims (#1014)
# ---------------------------------------------------------------------------


def _create_identity_link_claims() -> None:
    op.create_table(
        "identity_link_claims",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_member_id", sa.String(length=36), nullable=False),
        sa.Column("proposed_by", sa.String(length=36), nullable=True),
        sa.Column("source_approved_by", sa.String(length=36), nullable=True),
        sa.Column("source_approved_at", sa.String(length=40), nullable=True),
        sa.Column("target_user_id", sa.String(length=36), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("expires_at", sa.String(length=40), nullable=True),
        sa.Column("resulting_identity_link_id", sa.String(length=36), nullable=True),
        sa.Column("decided_by", sa.String(length=36), nullable=True),
        sa.Column("decided_at", sa.String(length=40), nullable=True),
        sa.Column("decision_reason", sa.String(length=500), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["decided_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["proposed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["resulting_identity_link_id"], ["identity_links.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["source_approved_by"], ["users.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["source_member_id"], ["members.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_identity_link_claims_source_member_id"),
        "identity_link_claims",
        ["source_member_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_identity_link_claims_target_user_id"),
        "identity_link_claims",
        ["target_user_id"],
        unique=False,
    )
    op.create_index(
        "uq_identity_link_claim_pending",
        "identity_link_claims",
        ["source_member_id", "target_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )


def _drop_identity_link_claims() -> None:
    op.drop_index(
        "uq_identity_link_claim_pending",
        table_name="identity_link_claims",
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.drop_index(
        op.f("ix_identity_link_claims_target_user_id"),
        table_name="identity_link_claims",
    )
    op.drop_index(
        op.f("ix_identity_link_claims_source_member_id"),
        table_name="identity_link_claims",
    )
    op.drop_table("identity_link_claims")


def upgrade() -> None:
    _rename_schema()
    _create_sections()
    _create_relation_indexes()
    _create_content_scopes()
    _create_scoped_grants()
    _create_identity_links()
    _create_saved_views()
    _create_migration_state()
    _create_member_name_search()
    _create_identity_link_claims()


def downgrade() -> None:
    _drop_identity_link_claims()
    _drop_member_name_search()
    _drop_migration_state()
    _drop_saved_views()
    _drop_identity_links()
    _drop_scoped_grants()
    _drop_content_scopes()
    _drop_relation_indexes()
    _drop_sections()
    _restore_schema()
