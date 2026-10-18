"""Per-area access levels for shared workspaces (#1101).

A grant (workspace membership or section grant) stores its levels as three
fields read together:

- ``role``: ``"editor"`` when at least one area is editable, else ``"viewer"``;
- ``restrictions``: areas the grantee may not see at all (Hidden);
- ``read_only``: areas an ``editor`` grant may see but not change (View).

Every other area is Edit for an editor grant and View for a viewer grant.
"""

from collections.abc import Iterable, Mapping

# The areas an owner sets a level for, in display order. "tree" covers
# people, relationships, and sections; it can be read-only but never hidden.
SHARE_AREAS: tuple[str, ...] = (
    "tree",
    "gallery",
    "sources",
    "stories",
    "events",
    "diseases",
    "tasks",
)
HIDEABLE_AREAS: frozenset[str] = frozenset(SHARE_AREAS) - {"tree"}
RESTRICTABLE_DOMAINS: set[str] = set(HIDEABLE_AREAS)

# Domains the pre-#1101 toggles had that now fold into an area: the map is
# built from events, and the biography notes belong with stories. "tree" was
# never enforced and can no longer be hidden, so it is dropped.
LEGACY_DOMAIN_ALIASES: dict[str, str | None] = {
    "map": "events",
    "biography": "stories",
    "tree": None,
}

LEVELS: tuple[str, ...] = ("hidden", "view", "edit")

# New shares hide health data by default (#1101); every preset does too.
DEFAULT_RESTRICTIONS: list[str] = ["diseases"]


def normalize_restrictions(domains: Iterable[str] | None) -> list[str] | None:
    """Map legacy domain keys onto areas, drop unknown ones, and sort."""
    result: set[str] = set()
    for domain in domains or ():
        area = LEGACY_DOMAIN_ALIASES.get(domain, domain)
        if area in HIDEABLE_AREAS:
            result.add(area)
    return sorted(result) or None


def levels_of(
    role: str, restrictions: Iterable[str] | None, read_only: Iterable[str] | None
) -> dict[str, str]:
    hidden = set(restrictions or ())
    view_only = set(read_only or ())
    levels: dict[str, str] = {}
    for area in SHARE_AREAS:
        if area in hidden:
            levels[area] = "hidden"
        elif role != "editor" or area in view_only:
            levels[area] = "view"
        else:
            levels[area] = "edit"
    return levels


def grant_fields_from_levels(
    levels: Mapping[str, str],
) -> tuple[str, list[str] | None, list[str] | None]:
    """``(role, restrictions, read_only)`` for a full set of area levels.

    Raises ``ValueError`` for an unknown area or level, a missing area, or a
    hidden tree.
    """
    unknown = set(levels) - set(SHARE_AREAS)
    if unknown:
        raise ValueError(f"Unknown areas: {sorted(unknown)}")
    missing = set(SHARE_AREAS) - set(levels)
    if missing:
        raise ValueError(f"Missing areas: {sorted(missing)}")
    bad = {area for area, level in levels.items() if level not in LEVELS}
    if bad:
        raise ValueError(f"Invalid level for: {sorted(bad)}")
    if levels["tree"] == "hidden":
        raise ValueError("The tree cannot be hidden")

    role = "editor" if "edit" in levels.values() else "viewer"
    restrictions = sorted(a for a, lvl in levels.items() if lvl == "hidden")
    read_only = (
        sorted(a for a, lvl in levels.items() if lvl == "view")
        if role == "editor"
        else []
    )
    return role, restrictions or None, read_only or None
