"""Bridge persons — the pair of member rows linked across two trees.

A tree-in-tree link stores the same human as one row per tree
(``Member.linked_member_id`` points at the counterpart). Person-level facts
are mirrored on edit when possible; when the editor lacks write access to the
other tree the rows drift. This module owns the shared field list, the
compare/copy helpers, and link-target validation used by the member routes
and the data-quality report.
"""

from sqlalchemy.orm import Session

from app.core.exceptions import AccessDeniedError, InvalidInputError, NotFoundError
from app.models.family import Member
from app.models.tree import Tree
from app.models.user import User
from app.services.media.storage import copy_media_to_tree
from app.services.tree_roles import role_for

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


def validate_linked_tree(
    db: Session, tree: Tree, user: User, linked_tree_id: str | None
) -> None:
    """Validate a tree-in-tree link target before it is persisted.

    A null id (clearing the link) is always allowed. Otherwise the target must
    exist and be readable by the user, and a member may not link to its own tree.
    """
    if linked_tree_id is None:
        return
    if linked_tree_id == tree.id:
        raise InvalidInputError("A member cannot link to its own tree")
    target = db.get(Tree, linked_tree_id)
    if target is None:
        raise NotFoundError("Linked tree not found")
    if (
        not user.is_admin
        and role_for(db, target, user) is None
        and target.public_role != "viewer"
    ):
        raise AccessDeniedError("No access to linked tree")


def validate_linked_member(
    db: Session,
    linked_tree_id: str | None,
    linked_member_id: str | None,
    member_id: str | None,
) -> None:
    """Validate the member-level counterpart of a tree-in-tree link.

    ``linked_member_id`` identifies the row in the linked tree that represents
    the same person (the bridge person), so it must live inside
    ``linked_tree_id``. Access is already covered by ``validate_linked_tree``.
    """
    if linked_member_id is None:
        return
    if linked_tree_id is None:
        raise InvalidInputError("A linked member requires a linked tree")
    if linked_member_id == member_id:
        raise InvalidInputError("A member cannot link to itself")
    target = db.get(Member, linked_member_id)
    if target is None or target.tree_id != linked_tree_id:
        raise InvalidInputError("Linked member is not part of the linked tree")


def sync_bridge_person(
    db: Session, member: Member, changes: dict, user: User
) -> tuple[str | None, Tree | None]:
    """Mirror identity-field edits onto the counterpart row of a bridge person.

    The two rows represent the same human, so person-level facts edited on one
    side propagate to the other when the actor may write the counterpart's tree;
    otherwise the rows simply drift until edited from a side with access.

    Returns ``(status, counterpart_tree)``: ``("synced", tree)`` when the
    counterpart was updated, ``("skipped_no_access", None)`` when identity
    fields changed but the actor may not write the other tree (the one case
    the editor should be told about), and ``(None, None)`` when there was
    nothing to sync (no link, no identity change, counterpart gone).
    """
    if member.linked_member_id is None:
        return None, None
    synced = {k: v for k, v in changes.items() if k in BRIDGE_SYNC_FIELDS}
    if not synced:
        return None, None
    counterpart = db.get(Member, member.linked_member_id)
    if counterpart is None:
        return None, None
    target_tree = db.get(Tree, counterpart.tree_id)
    if target_tree is None:
        return None, None
    if not user.is_admin and role_for(db, target_tree, user) not in (
        "owner",
        "editor",
    ):
        return "skipped_no_access", None
    for key, value in synced.items():
        if key == "image_data" and value:
            # Media files are tree-scoped: copy the file into the
            # counterpart's tree instead of sharing the URL across trees.
            value = copy_media_to_tree(value, counterpart.tree_id)
        setattr(counterpart, key, value)
    return "synced", target_tree
