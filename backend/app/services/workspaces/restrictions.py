"""Content restrictions for shared workspaces."""

RESTRICTABLE_DOMAINS: set[str] = {
    "tree",
    "gallery",
    "events",
    "map",
    "stories",
    "sources",
    "diseases",
    "biography",
    "tasks",
}

# New shares have access to all content domains unless the owner restricts them.
DEFAULT_RESTRICTIONS: list[str] = []
