"""Shared Member row primitives: identity keys, cloning, and field conflicts.

Used by every workflow that copies or merges a member — workspace merge
(``app.services.workspaces.merge``) and same-tree member merge
(``app.services.members.member_merge``).
"""

from __future__ import annotations

import re

from app.models import Member
from app.schemas.merge import FieldChoice
from app.services.media.storage import copy_media_to_workspace


def norm(value: str | None) -> str:
    return (value or "").strip().lower()


def _empty(value: str | None) -> bool:
    """True when the value should be treated as absent (None or blank)."""
    return not (value or "").strip()


_CAMEL_BOUNDARY = re.compile(r"(?<!^)(?=[A-Z])")


def to_snake_case(name: str) -> str:
    """Convert a camelCase field name (as the frontend sends field_choices /
    merge resolution keys) to the snake_case attribute name used on
    ``Member``. Already-snake_case input passes through unchanged."""
    return _CAMEL_BOUNDARY.sub("_", name).lower()


def member_key(m: Member) -> tuple:
    """Exact-duplicate key: name + gender + both dates (all normalised)."""
    return (
        norm(m.first_name),
        norm(m.last_name),
        m.gender,
        m.date_of_birth,
        m.date_of_death,
    )


def member_name_key(m: Member) -> tuple:
    """Name + gender only — used for possible-candidate detection."""
    return (norm(m.first_name), norm(m.last_name), m.gender)


CONFLICT_FIELDS: list[str] = [
    "middle_names",
    "baptismal_name",
    "maiden_name",
    "birthplace",
    "hometown",
    "cemetery",
    "places_lived",
    "additional_data",
    "image_data",
    "date_of_birth",
    "date_of_death",
]


def compute_conflicts(a: Member, b: Member) -> list[str]:
    """Return field names where the two members differ in a meaningful way.

    A field where only one side has a value is still reported (not just
    both-set-and-differing) — otherwise a lone value on the non-default side
    is never surfaced as a choice and gets silently dropped by whichever
    caller applies an all-empty default (#812).
    """
    conflicts: list[str] = []
    for field in CONFLICT_FIELDS:
        va = getattr(a, field, None)
        vb = getattr(b, field, None)
        # Treat None and "" as equal-empty
        if _empty(va) and _empty(vb):
            continue
        if (va or "") != (vb or ""):
            conflicts.append(field)
    return conflicts


def clone_member(m: Member, new_tree_id: str, new_id: str) -> Member:
    return Member(
        id=new_id,
        workspace_id=new_tree_id,
        gender=m.gender,
        academic_title=m.academic_title,
        deceased=m.deceased,
        adopted=m.adopted,
        first_name=m.first_name,
        middle_names=m.middle_names,
        baptismal_name=m.baptismal_name,
        last_name=m.last_name,
        maiden_name=m.maiden_name,
        image_data=copy_media_to_workspace(m.image_data, new_tree_id),
        date_of_birth=m.date_of_birth,
        date_of_death=m.date_of_death,
        additional_data=m.additional_data,
        is_collapsed=m.is_collapsed,
        position_x=m.position_x,
        position_y=m.position_y,
        birthplace=m.birthplace,
        hometown=m.hometown,
        cemetery=m.cemetery,
        places_lived=m.places_lived,
    )


def apply_field_choices(
    clone: Member,
    ma: Member,
    mb: Member,
    fields: dict[str, FieldChoice],
) -> None:
    """Apply per-field resolution choices to a merged clone.

    ``clone`` was already built from ``ma`` (source A); we apply overrides here.
    ``fields`` maps field_name → "a" | "b" | "combine".
    """
    text_fields = {"additional_data", "places_lived"}
    for field, choice in fields.items():
        if field not in CONFLICT_FIELDS:
            continue
        va = getattr(ma, field, None)
        vb = getattr(mb, field, None)
        if choice == "a":
            setattr(clone, field, va)
        elif choice == "b":
            setattr(clone, field, vb)
        elif choice == "combine" and field in text_fields:
            separator = "\n\n" if field == "additional_data" else ", "
            parts = [p for p in [va, vb] if not _empty(p)]
            # Deduplicate while preserving order
            seen: list[str] = []
            for p in parts:
                if p not in seen:
                    seen.append(p)
            setattr(clone, field, separator.join(seen) if seen else None)


