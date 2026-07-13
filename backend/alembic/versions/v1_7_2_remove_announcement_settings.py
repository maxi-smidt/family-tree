"""Remove obsolete release-announcement settings.

Revision ID: v1_7_2_remove_announcement
Revises: v1_7_1_document_uploads
Create Date: 2026-07-13 23:40:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import Connection

# revision identifiers, used by Alembic.
revision: str = "v1_7_2_remove_announcement"
down_revision: str | None = "v1_7_1_document_uploads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OBSOLETE_SETTING_KEYS = (
    "announcement_title",
    "announcement_body",
    "announcement_version",
)


def remove_obsolete_announcement_settings(connection: Connection) -> None:
    app_settings = sa.table("app_settings", sa.column("key", sa.String))
    connection.execute(
        sa.delete(app_settings).where(app_settings.c.key.in_(_OBSOLETE_SETTING_KEYS))
    )


def upgrade() -> None:
    remove_obsolete_announcement_settings(op.get_bind())


def downgrade() -> None:
    # The retired announcement values are intentionally not restored.
    pass
