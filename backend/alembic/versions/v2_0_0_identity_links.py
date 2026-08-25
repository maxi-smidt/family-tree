"""Add identity links, replacing the tree-in-tree bridge (#985).

Adds the normalized ``identity_links`` / ``identity_link_events`` /
``identity_link_blocks`` / ``identity_link_idempotency_keys`` tables (see
``app.models.identity_link``) and a composite uniqueness constraint on
``members (workspace_id, id)`` that ``identity_links`` targets with a
composite foreign key.

Every existing bridge pair (``Member.linked_member_id``) is converted into a
verified ``identity_links`` row with ``verification_basis =
"legacy_dual_write_access"`` — it was created by one actor with write access
to both trees, not necessarily approval from both current owners — and each
current owner gets a durable notification so they can review or unilaterally
revoke it. The legacy ``Member.linked_workspace_id`` / ``linked_member_id``
columns and ``app.services.members.bridge`` are left untouched; #1021 removes
them once this conversion has been live for a full release.

Revision ID: v2_0_0_identity_links
Revises: v2_0_0_scoped_grants
Create Date: 2026-08-25 00:00:00.000000

"""
import json
import uuid
from datetime import UTC, datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_identity_links"
down_revision: Union[str, None] = "v2_0_0_scoped_grants"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def migrate_legacy_bridges_to_identity_links(conn: sa.engine.Connection) -> int:
    """Convert every live bridge pair into a verified identity link.

    A self-join on ``members.linked_member_id`` finds only pairs whose
    counterpart row still exists (a dangling/already-cleared pointer is
    simply skipped), and each unordered pair is only ever converted once
    regardless of which side is scanned first. Returns the number created.
    """
    meta = sa.MetaData()
    meta.reflect(bind=conn, only=["members", "identity_links", "workspaces", "notifications"])
    members = meta.tables["members"]
    counterpart = members.alias("counterpart")
    links = meta.tables["identity_links"]
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
        workspace_a_id = row.workspace_id if a_id == row.id else row.counterpart_workspace_id
        workspace_b_id = row.counterpart_workspace_id if a_id == row.id else row.workspace_id

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


def upgrade() -> None:
    op.create_unique_constraint("uq_member_workspace_id_id", "members", ["workspace_id", "id"])

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
        sa.ForeignKeyConstraint(
            ["workspace_a_id", "member_a_id"],
            ["members.workspace_id", "members.id"],
            name="fk_identity_link_member_a",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_b_id", "member_b_id"],
            ["members.workspace_id", "members.id"],
            name="fk_identity_link_member_b",
            ondelete="CASCADE",
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

    conn = op.get_bind()
    migrate_legacy_bridges_to_identity_links(conn)


def downgrade() -> None:
    op.drop_table("identity_link_idempotency_keys")

    op.drop_index("ix_identity_link_blocks_blocked_user_id", table_name="identity_link_blocks")
    op.drop_index("ix_identity_link_blocks_workspace_id", table_name="identity_link_blocks")
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
