"""v1.8.0 release schema.

Includes normalized face regions on gallery-member links, self-managed
account profile fields (name + private profile image), research tasks
(member_tasks / member_task_link), gallery unknown-person face tags
(gallery_unknown_faces), the gallery "date taken" partial-date backfill, the
notifications inbox, and the member name/place field whitespace-trim backfill.

This single migration is the whole v1.8.0 delta over v1.7.0 (whose head was
``v1_7_0_release``); the pre-release ``v1_8_0_gallery_face_tags`` /
``v1_8_0_user_profiles`` / ``v1_8_0_research_tasks`` /
``v1_8_0_research_task_links`` / ``v1_8_0_gallery_unknown_faces`` /
``v1_8_0_gallery_partial_date`` / ``v1_8_0_notifications`` /
``v1_8_0_trim_member_fields`` / ``v1_8_0_merge_notif_trim`` steps were
squashed into it before the release was cut. The research-task schema's
dev-only intermediate shape (a nullable ``member_tasks.member_id`` column,
later repaired forward into ``member_task_link``) is not reproduced here —
this migration creates the final shape directly.

Revision ID: v1_8_0_release
Revises: v1_7_0_release
Create Date: 2026-07-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "v1_8_0_release"
down_revision: Union[str, None] = "v1_7_0_release"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Gallery face tags: normalized face regions on gallery-member links ---
    op.add_column("gallery_member_link", sa.Column("x", sa.Float(), nullable=True))
    op.add_column("gallery_member_link", sa.Column("y", sa.Float(), nullable=True))
    op.add_column("gallery_member_link", sa.Column("w", sa.Float(), nullable=True))
    op.add_column("gallery_member_link", sa.Column("h", sa.Float(), nullable=True))

    # --- Self-managed account profile fields + private profile image --------
    op.add_column(
        "users", sa.Column("first_name", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "users", sa.Column("last_name", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "users", sa.Column("profile_image", sa.String(length=255), nullable=True)
    )

    # --- Research tasks: open questions/to-dos linked to any number of ------
    # --- members (no links = tree-level task) --------------------------------
    op.create_table(
        "member_tasks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tree_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("done_at", sa.String(length=40), nullable=True),
        sa.ForeignKeyConstraint(["tree_id"], ["trees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_member_tasks_tree_id"), "member_tasks", ["tree_id"], unique=False
    )
    op.create_table(
        "member_task_link",
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("member_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["task_id"], ["member_tasks.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("task_id", "member_id"),
    )

    # --- Gallery unknown-person face tags -> research tasks ------------------
    op.create_table(
        "gallery_unknown_faces",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("gallery_image_id", sa.String(length=36), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=True),
        sa.ForeignKeyConstraint(
            ["gallery_image_id"], ["gallery_images.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["member_tasks.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_gallery_unknown_faces_gallery_image_id"),
        "gallery_unknown_faces",
        ["gallery_image_id"],
        unique=False,
    )

    # --- Data backfill: normalize gallery_images.created_at to the app's -----
    # --- partial-date format (issue #778) -------------------------------------
    # Rows created before this change store a full ISO-8601 timestamp, which the
    # partial-date picker can't parse; truncate to the YYYY-MM-DD date portion.
    # Already-partial values are left untouched. A no-op on a fresh database.
    op.execute(
        "UPDATE gallery_images "
        "SET created_at = SUBSTRING(created_at FROM 1 FOR 10) "
        "WHERE created_at IS NOT NULL AND LENGTH(created_at) > 10"
    )

    # --- Notifications: persistent per-user inbox for social/system events ---
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("payload", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("read_at", sa.String(length=40), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Single composite index — its user_id prefix serves user-scoped queries
    # and the FK cascade lookup, so no standalone user_id index is needed.
    op.create_index(
        "ix_notifications_user_created",
        "notifications",
        ["user_id", "created_at"],
        unique=False,
    )

    # --- Data backfill: trim whitespace from member name/place fields --------
    # (issue #796). The regular create/update path now trims on every write;
    # this one-off backfill strips whitespace from already-stored rows.
    op.execute(
        "UPDATE members SET "
        "gender = TRIM(gender), "
        "academic_title = TRIM(academic_title), "
        "first_name = TRIM(first_name), "
        "middle_names = TRIM(middle_names), "
        "baptismal_name = TRIM(baptismal_name), "
        "last_name = TRIM(last_name), "
        "maiden_name = TRIM(maiden_name), "
        "birthplace = TRIM(birthplace), "
        "hometown = TRIM(hometown), "
        "cemetery = TRIM(cemetery), "
        "additional_data = TRIM(additional_data)"
    )


def downgrade() -> None:
    # The two data backfills are intentionally not restored: the truncated
    # time-of-day and the stripped whitespace carried no meaning.
    op.drop_index("ix_notifications_user_created", table_name="notifications")
    op.drop_table("notifications")

    op.drop_index(
        op.f("ix_gallery_unknown_faces_gallery_image_id"),
        table_name="gallery_unknown_faces",
    )
    op.drop_table("gallery_unknown_faces")

    op.drop_table("member_task_link")
    op.drop_index(op.f("ix_member_tasks_tree_id"), table_name="member_tasks")
    op.drop_table("member_tasks")

    op.drop_column("users", "profile_image")
    op.drop_column("users", "last_name")
    op.drop_column("users", "first_name")

    op.drop_column("gallery_member_link", "h")
    op.drop_column("gallery_member_link", "w")
    op.drop_column("gallery_member_link", "y")
    op.drop_column("gallery_member_link", "x")
