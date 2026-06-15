"""Squashed baseline — complete schema as of initial release.

Pre-release squash: all incremental migrations collapsed into a single
initial migration.  No production databases exist, so there is no
upgrade ladder to maintain.

Revision ID: f8c1d2e3a4b5
Revises:
Create Date: 2026-06-15

"""
from datetime import UTC, datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "f8c1d2e3a4b5"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("username", sa.String(length=150), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("hashed_password", sa.String(length=255), nullable=True),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("auth_provider", sa.String(length=50), nullable=False),
        sa.Column("oauth_subject", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("deletion_requested_at", sa.String(length=40), nullable=True),
        sa.Column("deletion_scheduled_for", sa.String(length=40), nullable=True),
        sa.Column("deletion_requested_by", sa.String(length=36), nullable=True),
        sa.Column("tab_preferences", sa.JSON(), nullable=True),
        sa.Column("totp_secret", sa.String(64), nullable=True),
        sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("totp_recovery_codes", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("oauth_subject"),
    )
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)
    op.create_table(
        "feature_flag_overrides",
        sa.Column("feature", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("feature", "user_id"),
    )
    op.create_table(
        "friendships",
        sa.Column("requester_id", sa.String(36), nullable=False),
        sa.Column("addressee_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("responded_at", sa.String(40), nullable=True),
        sa.ForeignKeyConstraint(["requester_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["addressee_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("requester_id", "addressee_id"),
    )
    op.create_index("ix_friendships_requester_id", "friendships", ["requester_id"])
    op.create_index("ix_friendships_addressee_id", "friendships", ["addressee_id"])
    op.create_table(
        "backup_records",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("trigger", sa.String(20), nullable=False),
        sa.Column("filename", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_backup_records_created_at", "backup_records", ["created_at"])
    op.create_table(
        "geocode_cache",
        sa.Column("query", sa.String(255), nullable=False),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("display_name", sa.String(512), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.PrimaryKeyConstraint("query"),
    )
    # Global relation type registry (not per-tree).
    op.create_table(
        "relation_types",
        sa.Column("id", sa.String(length=50), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "trees",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("owner_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("last_opened", sa.String(length=40), nullable=True),
        sa.Column("public_role", sa.String(20), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_trees_owner_id"), "trees", ["owner_id"], unique=False)
    op.create_table(
        "tree_invitations",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("tree_id", sa.String(36), nullable=False),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("role", sa.String(20), nullable=False, server_default="editor"),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=True),
        sa.Column("accepted_at", sa.String(40), nullable=True),
        sa.Column("accepted_by", sa.String(36), nullable=True),
        sa.Column("revoked_at", sa.String(40), nullable=True),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["accepted_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tree_invitations_tree_id", "tree_invitations", ["tree_id"])
    op.create_index("ix_tree_invitations_token", "tree_invitations", ["token"], unique=True)
    op.create_table(
        "virtual_views",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("owner_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("last_opened", sa.String(length=40), nullable=True),
        sa.Column("matches_computed_at", sa.String(length=40), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_virtual_views_owner_id"), "virtual_views", ["owner_id"], unique=False
    )
    op.create_table(
        "activity_log",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("actor_id", sa.String(length=36), nullable=True),
        sa.Column("actor_username", sa.String(length=255), nullable=True),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("target_type", sa.String(length=40), nullable=False),
        sa.Column("target_id", sa.String(length=36), nullable=True),
        sa.Column("target_label", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_activity_log_actor_id"), "activity_log", ["actor_id"], unique=False
    )
    op.create_index(
        op.f("ix_activity_log_created_at"), "activity_log", ["created_at"], unique=False
    )
    op.create_index(
        op.f("ix_activity_log_tree_id"), "activity_log", ["tree_id"], unique=False
    )
    op.create_table(
        "events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("date", sa.String(length=40), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_events_tree_id"), "events", ["tree_id"], unique=False)
    op.create_table(
        "gallery_images",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("imageData", sa.Text(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("createdAt", sa.String(length=40), nullable=True),
        sa.Column("uploadedAt", sa.String(length=40), nullable=True),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_gallery_images_tree_id"), "gallery_images", ["tree_id"], unique=False
    )
    op.create_table(
        "members",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("gender", sa.String(length=1), nullable=True),
        sa.Column("firstName", sa.String(length=255), nullable=True),
        sa.Column("middleNames", sa.String(length=255), nullable=True),
        sa.Column("baptismalName", sa.String(length=255), nullable=True),
        sa.Column("lastName", sa.String(length=255), nullable=True),
        sa.Column("maidenName", sa.String(length=255), nullable=True),
        sa.Column("academicTitle", sa.String(length=100), nullable=True),
        sa.Column("imageData", sa.Text(), nullable=True),
        sa.Column("dateOfBirth", sa.String(length=40), nullable=True),
        sa.Column("dateOfDeath", sa.String(length=40), nullable=True),
        sa.Column("deceased", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("additionalData", sa.Text(), nullable=True),
        sa.Column("birthplace", sa.String(length=255), nullable=True),
        sa.Column("hometown", sa.String(length=255), nullable=True),
        sa.Column("placesLived", sa.Text(), nullable=True),
        sa.Column("isCollapsed", sa.Boolean(), nullable=False),
        sa.Column("positionX", sa.Float(), nullable=False),
        sa.Column("positionY", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_members_tree_id"), "members", ["tree_id"], unique=False)
    op.create_table(
        "sources",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("tree_id", sa.String(36), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("author", sa.String(255), nullable=True),
        sa.Column("publication_info", sa.Text(), nullable=True),
        sa.Column("repository", sa.String(255), nullable=True),
        sa.Column("source_date", sa.String(40), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sources_tree_id"), "sources", ["tree_id"], unique=False)
    op.create_table(
        "stories",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_stories_tree_id"), "stories", ["tree_id"], unique=False)
    op.create_table(
        "tree_memberships",
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("restrictions", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tree_id", "user_id"),
    )
    op.create_table(
        "virtual_view_positions",
        sa.Column("view_id", sa.String(length=40), nullable=False),
        sa.Column("node_id", sa.String(length=40), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["view_id"], ["virtual_views.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("view_id", "node_id"),
    )
    # virtual_view_sources: tree_id OR source_view_id (exactly one), PK on (view_id, position).
    op.create_table(
        "virtual_view_sources",
        sa.Column("view_id", sa.String(length=40), nullable=False),
        sa.Column("tree_id", sa.String(length=36), nullable=True),
        sa.Column("source_view_id", sa.String(length=40), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["view_id"], ["virtual_views.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["source_view_id"],
            ["virtual_views.id"],
            name="fk_vvs_source_view_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("view_id", "position", name="virtual_view_sources_pkey"),
        sa.CheckConstraint(
            "(tree_id IS NULL) <> (source_view_id IS NULL)",
            name="ck_vvs_exactly_one_source",
        ),
    )
    op.create_table(
        "event_member_link",
        sa.Column("event_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "member_id"),
    )
    op.create_table(
        "gallery_member_link",
        sa.Column("gallery_image_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["gallery_image_id"], ["gallery_images.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("gallery_image_id", "member_id"),
    )
    op.create_table(
        "member_diseases",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("carrier_status", sa.String(length=50), nullable=False),
        sa.Column("inheritance_pattern", sa.String(length=50), nullable=False),
        sa.Column("diagnosis_date", sa.String(length=40), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_member_diseases_member_id"),
        "member_diseases",
        ["member_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_member_diseases_tree_id"),
        "member_diseases",
        ["tree_id"],
        unique=False,
    )
    op.create_table(
        "relations",
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("from_member_id", sa.String(length=36), nullable=False),
        sa.Column("to_member_id", sa.String(length=36), nullable=False),
        sa.Column("relation_type", sa.String(length=50), nullable=False),
        sa.ForeignKeyConstraint(["from_member_id"], ["members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_member_id"], ["members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint(
            "tree_id", "from_member_id", "to_member_id", "relation_type"
        ),
    )
    op.create_table(
        "source_evidence",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("tree_id", sa.String(36), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("filename", sa.String(255), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=True),
        sa.Column("size", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_source_evidence_tree_id"), "source_evidence", ["tree_id"], unique=False
    )
    op.create_index(
        op.f("ix_source_evidence_source_id"),
        "source_evidence",
        ["source_id"],
        unique=False,
    )
    op.create_table(
        "story_attachments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("story_id", sa.String(length=36), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=True),
        sa.Column("size", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_story_attachments_story_id"),
        "story_attachments",
        ["story_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_story_attachments_tree_id"),
        "story_attachments",
        ["tree_id"],
        unique=False,
    )
    op.create_table(
        "story_member_link",
        sa.Column("story_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("story_id", "member_id"),
    )
    op.create_table(
        "citations",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("tree_id", sa.String(36), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("member_id", sa.String(36), nullable=False),
        sa.Column("fact_type", sa.String(40), nullable=False),
        sa.Column("page", sa.String(255), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_citations_tree_id"), "citations", ["tree_id"], unique=False
    )
    op.create_table(
        "virtual_view_member_matches",
        sa.Column("view_id", sa.String(length=40), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.Column("group_id", sa.String(length=40), nullable=False),
        sa.Column(
            "is_primary", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["view_id"], ["virtual_views.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("view_id", "member_id"),
    )
    op.create_index(
        "ix_vvmm_view_group",
        "virtual_view_member_matches",
        ["view_id", "group_id"],
        unique=False,
    )

    # Seed the default relation types used by existing data.
    now = datetime.now(UTC).isoformat()
    conn = op.get_bind()
    for rt_id, description in [
        ("partner", "Partner"),
        ("child", "Child"),
    ]:
        conn.execute(
            sa.text(
                "INSERT INTO relation_types (id, description) "
                "VALUES (:id, :description) ON CONFLICT DO NOTHING"
            ),
            {"id": rt_id, "description": description},
        )
    del now


def downgrade() -> None:
    op.drop_index("ix_vvmm_view_group", table_name="virtual_view_member_matches")
    op.drop_table("virtual_view_member_matches")
    op.drop_index(op.f("ix_citations_tree_id"), table_name="citations")
    op.drop_table("citations")
    op.drop_table("story_member_link")
    op.drop_index(op.f("ix_story_attachments_tree_id"), table_name="story_attachments")
    op.drop_index(op.f("ix_story_attachments_story_id"), table_name="story_attachments")
    op.drop_table("story_attachments")
    op.drop_index(op.f("ix_source_evidence_source_id"), table_name="source_evidence")
    op.drop_index(op.f("ix_source_evidence_tree_id"), table_name="source_evidence")
    op.drop_table("source_evidence")
    op.drop_table("relations")
    op.drop_index(op.f("ix_member_diseases_tree_id"), table_name="member_diseases")
    op.drop_index(op.f("ix_member_diseases_member_id"), table_name="member_diseases")
    op.drop_table("member_diseases")
    op.drop_table("gallery_member_link")
    op.drop_table("event_member_link")
    op.drop_table("virtual_view_sources")
    op.drop_table("virtual_view_positions")
    op.drop_table("tree_memberships")
    op.drop_index(op.f("ix_stories_tree_id"), table_name="stories")
    op.drop_table("stories")
    op.drop_index(op.f("ix_sources_tree_id"), table_name="sources")
    op.drop_table("sources")
    op.drop_index(op.f("ix_members_tree_id"), table_name="members")
    op.drop_table("members")
    op.drop_index(op.f("ix_gallery_images_tree_id"), table_name="gallery_images")
    op.drop_table("gallery_images")
    op.drop_index(op.f("ix_events_tree_id"), table_name="events")
    op.drop_table("events")
    op.drop_index(op.f("ix_activity_log_tree_id"), table_name="activity_log")
    op.drop_index(op.f("ix_activity_log_created_at"), table_name="activity_log")
    op.drop_index(op.f("ix_activity_log_actor_id"), table_name="activity_log")
    op.drop_table("activity_log")
    op.drop_index("ix_tree_invitations_token", table_name="tree_invitations")
    op.drop_index("ix_tree_invitations_tree_id", table_name="tree_invitations")
    op.drop_table("tree_invitations")
    op.drop_index(op.f("ix_virtual_views_owner_id"), table_name="virtual_views")
    op.drop_table("virtual_views")
    op.drop_index(op.f("ix_trees_owner_id"), table_name="trees")
    op.drop_table("trees")
    op.drop_table("relation_types")
    op.drop_table("geocode_cache")
    op.drop_index("ix_backup_records_created_at", table_name="backup_records")
    op.drop_table("backup_records")
    op.drop_index("ix_friendships_addressee_id", table_name="friendships")
    op.drop_index("ix_friendships_requester_id", table_name="friendships")
    op.drop_table("friendships")
    op.drop_table("feature_flag_overrides")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_table("users")
    op.drop_table("app_settings")
