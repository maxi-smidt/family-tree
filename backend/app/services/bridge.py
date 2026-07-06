"""Bridge persons — the pair of member rows linked across two trees.

A tree-in-tree link stores the same human as one row per tree
(``Member.linked_member_id`` points at the counterpart). Person-level facts
are mirrored on edit when possible; when the editor lacks write access to the
other tree the rows drift. This module owns the shared field list plus the
compare/copy helpers used by the member routes and the data-quality report.
"""

from app.models.family import Member
from app.services.storage import copy_media_to_tree

# Person-level fields mirrored between the two rows of a bridge person.
# Everything view- or link-related (positions, collapse state, the link ids
# themselves) stays per-tree.
BRIDGE_SYNC_FIELDS = {
    "gender",
    "academic_title",
    "first_name",
    "middle_names",
    "baptismal_name",
    "last_name",
    "maiden_name",
    "date_of_birth",
    "date_of_death",
    "deceased",
    "adopted",
    "additional_data",
    "birthplace",
    "hometown",
    "cemetery",
    "places_lived",
    "image_data",
}

# Fields considered by drift *detection*. Media URLs are tree-scoped (the same
# photo has a different path in each tree), so image_data can't be compared
# textually and is excluded — it still gets copied when drift is resolved.
BRIDGE_DRIFT_FIELDS = BRIDGE_SYNC_FIELDS - {"image_data"}


def drift_fields(a: Member, b: Member) -> list[str]:
    """Field names on which the two rows of a bridge person disagree.

    Empty string and None are treated as equal — clearing a text field on one
    side only should not count as drift.
    """
    return sorted(
        k
        for k in BRIDGE_DRIFT_FIELDS
        if (getattr(a, k) or None) != (getattr(b, k) or None)
    )


def copy_bridge_fields(src: Member, dst: Member) -> None:
    """Copy the person-level fields from one row of a bridge person to the
    other, duplicating the photo into the destination tree's media store."""
    for key in BRIDGE_SYNC_FIELDS:
        value = getattr(src, key)
        if key == "image_data" and value:
            value = copy_media_to_tree(value, dst.tree_id)
        setattr(dst, key, value)
