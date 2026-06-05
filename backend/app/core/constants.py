"""Domain constants shared across the backend."""

# Seeded into every new tree; mirrors the frontend ``constants.json``.
DEFAULT_RELATION_TYPES: list[str] = [
    "parent",
    "sibling",
    "partner",
    "married",
    "divorced",
    "other",
]
