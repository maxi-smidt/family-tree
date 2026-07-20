"""Normalize gallery_images.created_at to the app's partial-date format.

Issue #778 turns the gallery "date taken" field into an optional partial date
(``"YYYY"``, ``"YYYY-MM"``, or ``"YYYY-MM-DD"``, edited with the same
``PartialDatePicker`` used for member birth/death dates) instead of a full
calendar date that always defaulted to "now" at upload time. Every row created
before this change has ``created_at`` stored as a full ISO-8601 timestamp
(e.g. ``"2026-07-20T12:34:56.789012+00:00"``), which the partial-date picker
can't parse — it would render as blank even though a real date exists. This
truncates those legacy values down to their ``YYYY-MM-DD`` date portion so
existing photos keep displaying (and stay editable) instead of appearing
undated. Already-partial values (from re-running this migration, or written by
a version of the app already on the new format) are left untouched.

Revision ID: v1_8_0_gallery_partial_date
Revises: v1_8_0_gallery_unknown_faces
Create Date: 2026-07-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "v1_8_0_gallery_partial_date"
down_revision: Union[str, None] = "v1_8_0_gallery_unknown_faces"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE gallery_images "
        "SET created_at = SUBSTRING(created_at FROM 1 FOR 10) "
        "WHERE created_at IS NOT NULL AND LENGTH(created_at) > 10"
    )


def downgrade() -> None:
    # Intentionally not restored: the truncated time-of-day was always just
    # the upload instant, not a meaningful part of the photo-taken date.
    pass
