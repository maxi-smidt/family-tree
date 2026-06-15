import pytest
from fastapi import HTTPException

from app.models import Member, Relation
from app.schemas.extract import SubtreeExtractRequest
from app.services.extract import compute_subtree_preview, extract_subtree
from tests.conftest import add_member, make_tree, make_user


def add_relation(db, tree, from_id, to_id, rel_type="parent"):
    db.add(
        Relation(
            tree_id=tree.id,
            from_member_id=from_id,
            to_member_id=to_id,
            relation_type=rel_type,
        )
    )
    db.commit()


def req(**kw) -> SubtreeExtractRequest:
    defaults = {
        "name": "Sub-tree",
        "source_tree_id": "",
        "root_member_id": "",
        "direction": "descendants",
        "depth": None,
        "include_partners": False,
    }
    defaults.update(kw)
    return SubtreeExtractRequest(**defaults)


def members_of(db, tree):
    return db.query(Member).filter(Member.tree_id == tree.id).all()


def relations_of(db, tree):
    return db.query(Relation).filter(Relation.tree_id == tree.id).all()


# ---------------------------------------------------------------------------
# Traversal direction
# ---------------------------------------------------------------------------

def test_descendants_only(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    # grandparent -> parent -> child -> grandchild
    add_member(db, tree, "gp")
    add_member(db, tree, "p")
    add_member(db, tree, "c")
    add_member(db, tree, "gc")
    add_relation(db, tree, "p", "gp")   # p's parent is gp
    add_relation(db, tree, "c", "p")    # c's parent is p
    add_relation(db, tree, "gc", "c")   # gc's parent is c

    result = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="p")
    )

    # p -> c -> gc included; gp excluded
    assert len(members_of(db, result)) == 3
    # Source intact
    assert db.query(Member).filter(Member.tree_id == tree.id).count() == 4


def test_ancestors_only(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "gp")
    add_member(db, tree, "p")
    add_member(db, tree, "c")
    add_member(db, tree, "gc")
    add_relation(db, tree, "p", "gp")
    add_relation(db, tree, "c", "p")
    add_relation(db, tree, "gc", "c")

    result = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="c", direction="ancestors")
    )

    assert len(members_of(db, result)) == 3  # c, p, gp — not gc


def test_both_directions(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "gp")
    add_member(db, tree, "p")
    add_member(db, tree, "c")
    add_member(db, tree, "gc")
    add_relation(db, tree, "p", "gp")
    add_relation(db, tree, "c", "p")
    add_relation(db, tree, "gc", "c")

    result = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="p", direction="both")
    )

    assert len(members_of(db, result)) == 4  # all: gp, p, c, gc


# ---------------------------------------------------------------------------
# Depth bound
# ---------------------------------------------------------------------------

def test_depth_one_stops_at_one_generation(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "p")
    add_member(db, tree, "c")
    add_member(db, tree, "gc")
    add_relation(db, tree, "c", "p")
    add_relation(db, tree, "gc", "c")

    result = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="p", depth=1)
    )

    assert len(members_of(db, result)) == 2  # p + c; gc is 2 generations away


def test_depth_zero_returns_only_root(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "p")
    add_member(db, tree, "c")
    add_relation(db, tree, "c", "p")

    result = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="p", depth=0)
    )

    assert len(members_of(db, result)) == 1


# ---------------------------------------------------------------------------
# Partner inclusion
# ---------------------------------------------------------------------------

def test_partners_included_when_enabled(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "root")
    add_member(db, tree, "child")
    add_member(db, tree, "spouse")  # partner of root, not a descendant
    add_relation(db, tree, "child", "root")          # child's parent is root
    add_relation(db, tree, "root", "spouse", "partner")  # peer relation

    result = extract_subtree(
        db,
        user,
        req(source_tree_id=tree.id, root_member_id="root", include_partners=True),
    )

    assert len(members_of(db, result)) == 3  # root + child + spouse


def test_partners_excluded_when_disabled(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "root")
    add_member(db, tree, "child")
    add_member(db, tree, "spouse")
    add_relation(db, tree, "child", "root")
    add_relation(db, tree, "root", "spouse", "partner")

    result = extract_subtree(
        db,
        user,
        req(source_tree_id=tree.id, root_member_id="root", include_partners=False),
    )

    assert len(members_of(db, result)) == 2  # root + child only


# ---------------------------------------------------------------------------
# Relation filtering
# ---------------------------------------------------------------------------

def test_relations_to_excluded_members_are_dropped(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "p")
    add_member(db, tree, "c1")
    add_member(db, tree, "c2")
    add_relation(db, tree, "c1", "p")
    add_relation(db, tree, "c2", "p")

    # Root c1 + ancestors only => c1 + p; c2 excluded.
    result = extract_subtree(
        db,
        user,
        req(source_tree_id=tree.id, root_member_id="c1", direction="ancestors"),
    )

    assert len(members_of(db, result)) == 2  # c1 + p
    assert len(relations_of(db, result)) == 1  # only c1->p, not c2->p


# ---------------------------------------------------------------------------
# Id regeneration & source intact
# ---------------------------------------------------------------------------

def test_ids_regenerated_and_source_unchanged(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "orig")
    add_member(db, tree, "child")
    add_relation(db, tree, "child", "orig")

    result = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="orig")
    )

    new_ids = {m.id for m in members_of(db, result)}
    assert "orig" not in new_ids
    assert "child" not in new_ids

    # Source still intact
    src_ids = {m.id for m in members_of(db, tree)}
    assert src_ids == {"orig", "child"}


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

def test_requires_accessible_source(db):
    owner = make_user(db, "owner")
    stranger = make_user(db, "mallory")
    private = make_tree(db, owner)
    add_member(db, private, "m1")

    with pytest.raises(HTTPException) as exc:
        extract_subtree(
            db, stranger, req(source_tree_id=private.id, root_member_id="m1")
        )
    assert exc.value.status_code == 404


def test_foreign_root_member_raises(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1")

    with pytest.raises(HTTPException) as exc:
        extract_subtree(
            db, user, req(source_tree_id=tree.id, root_member_id="does-not-exist")
        )
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def test_preview_returns_counts(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "p")
    add_member(db, tree, "c")
    add_relation(db, tree, "c", "p")

    preview = compute_subtree_preview(
        db, user, req(source_tree_id=tree.id, root_member_id="p")
    )
    assert preview.member_count == 2
    assert preview.relation_count == 1

    # Preview must not write anything
    assert db.query(Member).filter(Member.tree_id == tree.id).count() == 2
