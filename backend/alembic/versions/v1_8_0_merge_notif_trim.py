"""Merge point: notifications inbox and member-field trimming landed as
sibling branches off v1_8_0_gallery_partial_date. Both are independent
(a new table vs. a data backfill on members) — no operational overlap.

Revision ID: v1_8_0_merge_notif_trim
Revises: v1_8_0_notifications, v1_8_0_trim_member_fields
Create Date: 2026-07-22 17:30:00.000000

"""
from typing import Sequence, Union


revision: str = "v1_8_0_merge_notif_trim"
down_revision: Union[str, Sequence[str], None] = (
    "v1_8_0_notifications",
    "v1_8_0_trim_member_fields",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
