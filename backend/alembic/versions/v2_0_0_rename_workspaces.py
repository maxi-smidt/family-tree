"""Rename trees to workspaces and tree IDs to workspace IDs."""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v2_0_0_rename_workspaces"
down_revision: Union[str, None] = "v1_10_0_remove_feature_flags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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


def upgrade() -> None:
    _rename_schema()


def downgrade() -> None:
    _restore_schema()

