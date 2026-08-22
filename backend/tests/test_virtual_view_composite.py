"""Focused tests for the composite-construction functions extracted to
app.services.virtual_views.virtual_view_composite (#887) — exercised directly against the
DB, without going through the HTTP layer.
"""

from sqlalchemy.orm import Session

from app.models.family import Relation
from app.models.virtual_view import VirtualView, VirtualViewSource
from app.services.virtual_views.virtual_view_composite import (
    build_composite_members,
    build_composite_relations,
)
from app.services.virtual_views.virtual_view_matching import group_id_for, persist_matches
from tests.conftest import add_member, make_tree, make_user


def _make_view(db: Session, owner, *trees) -> VirtualView:
    view = VirtualView(name="Composite", owner_id=owner.id)
    db.add(view)
    db.flush()
    for i, tree in enumerate(trees):
        db.add(VirtualViewSource(view_id=view.id, position=i, tree_id=tree.id))
    db.flush()
    persist_matches(db, view)
    db.commit()
    db.refresh(view)
    return view


def test_build_composite_members_coalesces_fields_across_three_sources(db: Session):
    owner = make_user(db)
    tree_a = make_tree(db, owner, "A")
    tree_b = make_tree(db, owner, "B")
    tree_c = make_tree(db, owner, "C")

    add_member(
        db, tree_a, "a1", first_name="John", last_name="Smith",
        date_of_birth="1900", gender="m",
    )
    add_member(
        db, tree_b, "b1", first_name="John", last_name="Smith",
        date_of_birth="1900", gender="m", baptismal_name="Johannes",
    )
    add_member(
        db, tree_c, "c1", first_name="John", last_name="Smith",
        date_of_birth="1900", gender="m", middle_names="Robert",
    )

    view = _make_view(db, owner, tree_a, tree_b, tree_c)
    members = build_composite_members(db, view)

    assert len(members) == 1
    merged = members[0]
    assert merged.is_merged is True
    assert set(merged.merged_from_ids) == {"a1", "b1", "c1"}
    # Coalesced fields fall back to the first source (in tree order) that has one.
    assert merged.baptismal_name == "Johannes"
    assert merged.middle_names == "Robert"
    # The primary member (first source with a match) provides the canonical id.
    assert merged.source_tree_id == tree_a.id


def test_build_composite_relations_prefers_earliest_source_with_parents(
    db: Session,
):
    """relation_type="parent" points from the child to the parent. When the
    primary source member (tree A, first in source order) has no parent edge
    of its own, the merged node's parent edges are pulled from the first
    *secondary* source (tree B) that has one — never both, and never tree C —
    so the merged node never accumulates more than two parents."""
    owner = make_user(db)
    tree_a = make_tree(db, owner, "A")
    tree_b = make_tree(db, owner, "B")
    tree_c = make_tree(db, owner, "C")

    add_member(
        db, tree_a, "child_a", first_name="Kid", last_name="Smith",
        date_of_birth="1950", gender="m",
    )
    add_member(
        db, tree_b, "child_b", first_name="Kid", last_name="Smith",
        date_of_birth="1950", gender="m",
    )
    add_member(
        db, tree_c, "child_c", first_name="Kid", last_name="Smith",
        date_of_birth="1950", gender="m",
    )
    add_member(
        db, tree_b, "parent_b", first_name="Par", last_name="Ent",
        date_of_birth="1920", gender="f",
    )
    add_member(
        db, tree_c, "parent_c", first_name="Par2", last_name="Ent2",
        date_of_birth="1920", gender="f",
    )

    view = _make_view(db, owner, tree_a, tree_b, tree_c)

    db.add(
        Relation(
            tree_id=tree_b.id,
            from_member_id="child_b",
            to_member_id="parent_b",
            relation_type="parent",
        )
    )
    db.add(
        Relation(
            tree_id=tree_c.id,
            from_member_id="child_c",
            to_member_id="parent_c",
            relation_type="parent",
        )
    )
    db.commit()

    relations = build_composite_relations(db, view)
    parent_edges = [r for r in relations if r.relation_type == "parent"]
    child_node_id = group_id_for(["child_a", "child_b", "child_c"])
    assert len(parent_edges) == 1
    assert parent_edges[0].from_member_id == child_node_id
    assert parent_edges[0].to_member_id == "parent_b"
