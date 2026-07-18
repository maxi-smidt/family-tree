"""Shared member-name search primitives.

The tree-local and global search endpoints deliberately use the same fields and
ordering so a person does not disappear when the user expands a search beyond
the current tree.
"""

from sqlalchemy import or_

from app.models import Member

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
    Member.linked_tree_id,
    Member.linked_member_id,
)


def member_name_search_clause(query: str):
    """Return the name fields shared by tree-local and global search."""
    pattern = f"%{query}%"
    return or_(
        Member.first_name.ilike(pattern),
        Member.last_name.ilike(pattern),
        Member.maiden_name.ilike(pattern),
    )
