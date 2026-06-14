from app.models import Member, Relation
from app.services.merge import merge_trees
from tests.conftest import add_member, make_tree, make_user


def test_merge_dedupes_identical_members(db):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")

    add_member(db, tree_a, "a1", firstName="Ada", lastName="Doe", gender="f")
    add_member(db, tree_b, "b1", firstName="ada", lastName="doe", gender="f")
    add_member(db, tree_b, "b2", firstName="Bob", lastName="Doe", gender="m")

    merged = merge_trees(db, user, "Merged", tree_a.id, tree_b.id)

    members = db.query(Member).filter(Member.tree_id == merged.id).all()
    names = sorted((m.firstName.lower(), m.lastName.lower()) for m in members)
    # Ada (matched across both trees) collapses into one; Bob stays separate.
    assert names == [("ada", "doe"), ("bob", "doe")]


def test_merge_remaps_relations_and_regenerates_ids(db):
    user = make_user(db, "alice")
    source = make_tree(db, user, "Source")
    add_member(
        db,
        source,
        "child",
        firstName="Kid",
        middleNames="Middle",
        baptismalName="Baptismal",
        gender="m",
    )
    add_member(db, source, "parent", firstName="Pa", gender="m")
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
    child = next(m for m in members if m.firstName == "Kid")
    assert child.middleNames == "Middle"
    assert child.baptismalName == "Baptismal"

    relations = db.query(Relation).filter(Relation.tree_id == merged.id).all()
    assert len(relations) == 1
    id_by_name = {m.firstName: m.id for m in members}
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
