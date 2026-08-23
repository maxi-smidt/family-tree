"""Tests for GET /trees/{tree_id}/statistics/combined (issue #566)."""

from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _combined_url(tree_id: str) -> str:
    return f"{API}/trees/{tree_id}/statistics/combined"


def _link(db, tree, member_id, target_tree, **kw):
    return add_member(
        db, tree, member_id, linked_tree_id=target_tree.id, first_name="A", **kw
    )


def _bridge_pair(db, tree_a, member_a_id, tree_b, member_b_id, **kw):
    """Create a bridge-person pair: two member rows, each pointing at the other.

    ``linked_member_id`` is a FK to ``members.id``, so both rows must exist
    before either can reference the other — create plain rows first, then
    set the cross-links.
    """
    a = add_member(db, tree_a, member_a_id, linked_tree_id=tree_b.id, **kw)
    b = add_member(db, tree_b, member_b_id, linked_tree_id=tree_a.id, **kw)
    a.linked_member_id = member_b_id
    b.linked_member_id = member_a_id
    db.commit()


def test_union_sums_members_across_linked_tree(client, db):
    user = make_user(db, "alice")
    t1 = make_tree(db, user, "T1")
    t2 = make_tree(db, user, "T2")
    add_member(db, t1, "a1", first_name="Ada", last_name="One")
    add_member(db, t1, "a2", first_name="Bob", last_name="Two")
    add_member(db, t2, "b1", first_name="Cara", last_name="Three")
    _link(db, t1, "bridge1", t2)

    res = client.get(_combined_url(t1.id), headers=auth(user))
    assert res.status_code == 200
    body = res.json()

    # a1, a2, bridge1 (t1) + b1 (t2) = 4 total members.
    assert body["total_members"] == 4
    assert body["tree_count"] == 2
    assert set(body["included_tree_ids"]) == {t1.id, t2.id}
    assert body["tree_id"] == t1.id


def test_bridge_person_counted_once(client, db):
    user = make_user(db, "alice")
    t1 = make_tree(db, user, "T1")
    t2 = make_tree(db, user, "T2")
    _bridge_pair(db, t1, "bp1", t2, "bp2", first_name="Grandpa", last_name="Bridge")
    add_member(db, t1, "solo1", first_name="Solo", last_name="One")

    res = client.get(_combined_url(t1.id), headers=auth(user))
    assert res.status_code == 200
    body = res.json()

    # bp1/bp2 collapse to one person + solo1 = 2, not 3.
    assert body["total_members"] == 2
    assert body["tree_count"] == 2


def test_inaccessible_linked_tree_excluded(client, db):
    owner = make_user(db, "alice")
    stranger = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    private_other = make_tree(db, stranger, "Strangers")
    add_member(db, main, "m1", first_name="Solo", last_name="One")
    add_member(db, private_other, "m2", first_name="Hidden", last_name="Two")
    _link(db, main, "bridge1", private_other)

    res = client.get(_combined_url(main.id), headers=auth(owner))
    assert res.status_code == 200
    body = res.json()

    # Only main's own members (m1, bridge1) are counted; private_other excluded.
    assert body["total_members"] == 2
    assert body["tree_count"] == 1
    assert body["included_tree_ids"] == [main.id]


def test_inaccessible_tree_becomes_accessible_via_share(client, db):
    owner = make_user(db, "alice")
    friend = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    shared_other = make_tree(db, friend, "Shared")
    share(db, shared_other, owner, "viewer")
    add_member(db, shared_other, "m2", first_name="Visible", last_name="Two")
    _link(db, main, "bridge1", shared_other)

    res = client.get(_combined_url(main.id), headers=auth(owner))
    assert res.status_code == 200
    body = res.json()

    assert body["tree_count"] == 2
    assert set(body["included_tree_ids"]) == {main.id, shared_other.id}
    # bridge1 (main) + m2 (shared_other) = 2.
    assert body["total_members"] == 2


def test_non_readable_start_tree_returns_403(client, db):
    owner = make_user(db, "alice")
    stranger = make_user(db, "bob")
    tree = make_tree(db, owner, "Private")

    res = client.get(_combined_url(tree.id), headers=auth(stranger))
    assert res.status_code == 403


def test_no_linked_trees_matches_single_tree_statistics(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "Solo")
    add_member(db, tree, "m1", first_name="Solo", last_name="One")

    res = client.get(_combined_url(tree.id), headers=auth(user))
    assert res.status_code == 200
    body = res.json()
    assert body["total_members"] == 1
    assert body["tree_count"] == 1
    assert body["included_tree_ids"] == [tree.id]
