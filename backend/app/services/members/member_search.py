"""Shared member-name search primitives.

The tree-local and global search endpoints deliberately use the same fields and
ordering so a person does not disappear when the user expands a search beyond
the current tree.
"""

import re

from sqlalchemy import and_, or_

from app.models import Member

_YEAR_TOKEN = re.compile(r"\d{4}")

# Keep this projection aligned with ``MemberSurfaceOut``. It lets search
# endpoints return the information needed to identify a person without loading
# the heavier ``additional_data`` column used by the detail sheet.
MEMBER_SURFACE_COLUMNS = (
    Member.id,
    Member.gender,
    Member.academic_title,
    Member.first_name,
    Member.middle_names,
    Member.baptismal_name,
    Member.last_name,
    Member.maiden_name,
    Member.image_data,
    Member.date_of_birth,
    Member.date_of_death,
    Member.date_of_birth_sort,
    Member.date_of_death_sort,
    Member.deceased,
    Member.birthplace,
    Member.hometown,
    Member.cemetery,
    Member.places_lived,
    Member.is_collapsed,
    Member.position_x,
    Member.position_y,
)


def _token_clause(token: str):
    """OR clause matching a single query token against one member.

    A bare word matches any name field; a 4-digit year additionally matches
    the birth/death date strings, so e.g. ``"1932"`` finds members born or
    deceased that year without excluding a numeric-looking name field.
    """
    pattern = f"%{token}%"
    clauses = [
        Member.first_name.ilike(pattern),
        Member.last_name.ilike(pattern),
        Member.maiden_name.ilike(pattern),
    ]
    if _YEAR_TOKEN.fullmatch(token):
        clauses += [
            Member.date_of_birth.ilike(pattern),
            Member.date_of_death.ilike(pattern),
        ]
    return or_(*clauses)


def normalize_member_name(
    first_name: str | None, last_name: str | None, maiden_name: str | None
) -> str:
    """Derive ``Member.name_normalized`` from the same three fields
    ``member_name_search_clause`` matches against (#1024).

    Shared so every path that writes a member — the ORM validator on
    ``Member`` for normal writes, and the bulk-insert import paths
    (``tree_bundle_import``, GEDCOM) that bypass it — derives the identical
    value.
    """
    parts = (first_name, last_name, maiden_name)
    return " ".join(p.strip() for p in parts if p).lower()


def member_name_search_clause(query: str):
    """Return the name fields shared by tree-local and global search.

    A single-token query keeps the original whole-string substring match. A
    multi-token query (e.g. ``"Last First"`` or ``"Anna Müller 1932"``) is
    split on whitespace and AND-ed token by token, so tokens can land in any
    order across ``first_name``/``last_name``/``maiden_name`` (and a
    year-shaped token also against the birth/death dates).
    """
    tokens = query.split()
    if len(tokens) <= 1:
        return _token_clause(query)
    return and_(*(_token_clause(token) for token in tokens))
