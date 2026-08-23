"""Remove runtime feature-flag storage.

Existing installations lose the obsolete override table and ``feature.*``
settings. The live application no longer reads either structure. Older
encrypted backups are normalized separately by the backup restore path.

Revision ID: v1_10_0_remove_feature_flags
Revises: v1_9_0_tree_last_opened_per_user
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v1_10_0_remove_feature_flags"
down_revision: Union[str, None] = "v1_9_0_tree_last_opened_per_user"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def remove_feature_flag_storage(bind) -> None:
    app_settings = sa.table("app_settings", sa.column("key", sa.String(length=100)))
    bind.execute(
        sa.delete(app_settings).where(
            app_settings.c.key.like("feature.%")
        )
    )

    if "feature_flag_overrides" in sa.inspect(bind).get_table_names():
        sa.Table("feature_flag_overrides", sa.MetaData(), autoload_with=bind).drop(
            bind
        )


def upgrade() -> None:
    remove_feature_flag_storage(op.get_bind())


def downgrade() -> None:
    op.create_table(
        "feature_flag_overrides",
        sa.Column("feature", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("feature", "user_id"),
    )
