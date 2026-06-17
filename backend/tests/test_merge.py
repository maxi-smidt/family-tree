from app.models import Member, Relation
from app.services.merge import merge_trees
from tests.conftest import add_member, make_tree, make_user


def test_merge_dedupes_identical_members(db):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")

    add_member(db, tree_a, "a1", first_name="Ada", last_name="Doe", gender="f")
    add_member(db, tree_b, "b1", first_name="ada", last_name="doe", gender="f")
    add_member(db, tree_b, "b2", first_name="Bob", last_name="Doe", gender="m")

    merged = merge_trees(db, user, "Merged", tree_a.id, tree_b.id)

    members = db.query(Member).filter(Member.tree_id == merged.id).all()
    names = sorted((m.first_name.lower(), m.last_name.lower()) for m in members)
    # Ada (matched across both trees) collapses into one; Bob stays separate.
    assert names == [("ada", "doe"), ("bob", "doe")]


def test_merge_remaps_relations_and_regenerates_ids(db):
    user = make_user(db, "alice")
    source = make_tree(db, user, "Source")
    add_member(
        db,
        source,
        "child",
        first_name="Kid",
        middle_names="Middle",
        baptismal_name="Baptismal",
        gender="m",
    )
    add_member(db, source, "parent", first_name="Pa", gender="m")
    db.add(
        Relation(
            tree_id=source.id,
            from_member_id="child",
            to_member_id="parent",
            relation_type="parent",
        )
    )
    db.commit()

    merged = merge_trees(db, user, "Copy", source.id, None)

    members = db.query(Member).filter(Member.tree_id == merged.id).all()
    assert {m.id for m in members}.isdisjoint({"child", "parent"})  # ids regenerated
    child = next(m for m in members if m.first_name == "Kid")
    assert child.middle_names == "Middle"
    assert child.baptismal_name == "Baptismal"

    relations = db.query(Relation).filter(Relation.tree_id == merged.id).all()
    assert len(relations) == 1
    id_by_name = {m.first_name: m.id for m in members}
    assert relations[0].from_member_id == id_by_name["Kid"]
    assert relations[0].to_member_id == id_by_name["Pa"]


def test_merge_requires_owned_or_shared_source(db):
    owner = make_user(db, "owner")
    stranger = make_user(db, "mallory")
    private_tree = make_tree(db, owner, "Private")

    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        merge_trees(db, stranger, "Steal", private_tree.id, None)
    assert exc.value.status_code == 404
