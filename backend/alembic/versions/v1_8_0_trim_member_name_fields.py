"""Trim whitespace from member name/place fields.

Issue #796: the regular member create/update path stored name-like fields
exactly as submitted, with no server-side trimming, while the GEDCOM importer
already stripped them. A member saved with a trailing/leading space (copy-paste,
stray keystroke) would not reliably match search or duplicate detection. The
Pydantic schemas now trim these fields on every write going forward; this
one-off backfill strips whitespace from existing rows so already-stored data
is consistent too.

Revision ID: v1_8_0_trim_member_fields
Revises: v1_8_0_gallery_partial_date
Create Date: 2026-07-21 10:22:10.845559

"""
from typing import Sequence, Union

from alembic import op

revision: str = "v1_8_0_trim_member_fields"
down_revision: Union[str, None] = "v1_8_0_gallery_partial_date"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
    # Intentionally not restored: the stripped whitespace carried no meaning.
    pass
