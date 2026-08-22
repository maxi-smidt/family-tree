"""Shared Member row primitives: identity keys, cloning, and bridge wiring.

Used by every workflow that copies or links a member across trees — tree
merge (``app.services.merge``), sub-tree extraction (``app.services.extract``),
linked-subtree creation (``app.services.member_subtrees``), same-tree member
merge (``app.services.member_merge``), and the tree-link endpoints
(``app.api.routes.members``).
"""

from __future__ import annotations

import re

from app.models import Member
from app.schemas.merge import FieldChoice
from app.services.media.storage import copy_media_to_tree


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
        norm(m.first_name), norm(m.last_name),
        m.gender, m.date_of_birth, m.date_of_death,
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
        tree_id=new_tree_id,
        gender=m.gender,
        academic_title=m.academic_title,
        deceased=m.deceased,
        adopted=m.adopted,
        first_name=m.first_name,
        middle_names=m.middle_names,
        baptismal_name=m.baptismal_name,
        last_name=m.last_name,
        maiden_name=m.maiden_name,
        image_data=copy_media_to_tree(m.image_data, new_tree_id),
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


def wire_bridge(source: Member, counterpart: Member) -> None:
    """Point two member rows at each other as a bridge person pair.

    Shared by every flow that establishes a tree-in-tree link (create-linked-
    subtree, extract-subtree, and the link-existing-tree endpoint) so the
    bidirectional wiring stays in one place.
    """
    source.linked_tree_id = counterpart.tree_id
    source.linked_member_id = counterpart.id
    counterpart.linked_tree_id = source.tree_id
    counterpart.linked_member_id = source.id


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


def reconcile_bridge_fields(
    member: Member,
    counterpart: Member,
    choices: dict[str, FieldChoice] | None = None,
) -> None:
    """Reconcile the conflicting fields of a freshly-wired bridge pair.

    Used by the link-existing-tree flow (mode="existing") right after
    ``wire_bridge``: the two rows represent the same human, so once linked
    their conflicting fields (dates, places, images, notes, ...) should agree
    on both sides, not just drift until a later edit or bridge-sync.

    For each field in ``CONFLICT_FIELDS`` an explicit choice ("a" | "b" |
    "combine", a = ``member``, b = ``counterpart``) from ``choices`` is
    applied when given; otherwise the fields are unioned (whichever side is
    non-empty wins, preferring ``member`` when both are set) via the same
    a/b/combine semantics as ``apply_field_choices``. ``image_data`` is copied
    into the destination tree's media store, mirroring
    ``bridge.copy_bridge_fields``.

    ``choices`` keys may be camelCase (as sent by the frontend, matching its
    ``RESOLVABLE_FIELDS``) or snake_case; both are normalised to the
    ``Member`` attribute name.
    """
    choices = choices or {}
    normalised_choices = {to_snake_case(k): v for k, v in choices.items()}
    resolved: dict[str, FieldChoice] = {
        k: v for k, v in normalised_choices.items() if k in CONFLICT_FIELDS
    }
    for field in CONFLICT_FIELDS:
        if field in resolved:
            continue
        va = getattr(member, field, None)
        vb = getattr(counterpart, field, None)
        # Union default: prefer whichever side is non-empty; when both are
        # set (a genuine conflict with no explicit choice) keep A's value.
        resolved[field] = "a" if not _empty(va) or _empty(vb) else "b"

    # Snapshot pre-reconciliation values so both a→b and b→a copies read the
    # same source data even though `member` is mutated first below.
    orig_member = {f: getattr(member, f, None) for f in CONFLICT_FIELDS}
    orig_counterpart = {f: getattr(counterpart, f, None) for f in CONFLICT_FIELDS}

    for field, choice in resolved.items():
        if choice == "a":
            value = orig_member[field]
        elif choice == "b":
            value = orig_counterpart[field]
        else:  # combine
            if field in {"additional_data", "places_lived"}:
                separator = "\n\n" if field == "additional_data" else ", "
                parts = [
                    p for p in [orig_member[field], orig_counterpart[field]]
                    if not _empty(p)
                ]
                seen: list[str] = []
                for p in parts:
                    if p not in seen:
                        seen.append(p)
                value = separator.join(seen) if seen else None
            else:
                # Combine doesn't apply to non-text fields; fall back to A.
                value = orig_member[field]

        if field == "image_data":
            member.image_data = (
                value if value == orig_member["image_data"]
                else copy_media_to_tree(value, member.tree_id)
            )
            counterpart.image_data = (
                value if value == orig_counterpart["image_data"]
                else copy_media_to_tree(value, counterpart.tree_id)
            )
        else:
            setattr(member, field, value)
            setattr(counterpart, field, value)
