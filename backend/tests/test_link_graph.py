"""Tests for GET /workspaces/{workspace_id}/link-graph (issue #536)."""

from app.services.workspaces.workspace_links import compute_link_graph
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _link(db, tree, member_id, target_tree, **kw):
    return add_member(
        db, tree, member_id, linked_workspace_id=target_tree.id, first_name="A", **kw
    )


def test_chain_fully_accessible_returns_all_nodes_and_edges(client, db):
    user = make_user(db, "alice")
    t1 = make_tree(db, user, "T1")
    t2 = make_tree(db, user, "T2")
    t3 = make_tree(db, user, "T3")
    _link(db, t1, "m1", t2, last_name="One")
    _link(db, t2, "m2", t3, last_name="Two")

    res = client.get(f"{API}/workspaces/{t1.id}/link-graph", headers=auth(user))
    assert res.status_code == 200
    body = res.json()

    assert body["truncated"] is False
    node_ids = {n["id"] for n in body["nodes"]}
    assert node_ids == {t1.id, t2.id, t3.id}
    assert len(body["edges"]) == 2

    current = next(n for n in body["nodes"] if n["id"] == t1.id)
    assert current["is_current"] is True
    assert current["accessible"] is True
    assert current["name"] == "T1"
    assert current["role"] == "owner"

    other = next(n for n in body["nodes"] if n["id"] == t2.id)
    assert other["is_current"] is False
    assert other["accessible"] is True
    assert other["name"] == "T2"

    edge = next(e for e in body["edges"] if e["source_workspace_id"] == t1.id)
    assert edge["target_workspace_id"] == t2.id
    assert edge["count"] == 1
    assert edge["bridge_members"][0]["id"] == "m1"
    assert edge["bridge_members"][0]["name"] == "A One"


def test_cycle_terminates_and_returns_both_edges(client, db):
    user = make_user(db, "alice")
    a = make_tree(db, user, "A")
    b = make_tree(db, user, "B")
    _link(db, a, "m1", b)
    _link(db, b, "m2", a)

    res = client.get(f"{API}/workspaces/{a.id}/link-graph", headers=auth(user))
    assert res.status_code == 200
    body = res.json()

    node_ids = {n["id"] for n in body["nodes"]}
    assert node_ids == {a.id, b.id}
    assert len(body["edges"]) == 2
    pairs = {(e["source_workspace_id"], e["target_workspace_id"]) for e in body["edges"]}
    assert pairs == {(a.id, b.id), (b.id, a.id)}


def test_link_to_inaccessible_tree_is_placeholder(client, db):
    owner = make_user(db, "alice")
    stranger = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    private_other = make_tree(db, stranger, "Strangers")
    _link(db, main, "m1", private_other)

    res = client.get(f"{API}/workspaces/{main.id}/link-graph", headers=auth(owner))
    assert res.status_code == 200
    body = res.json()

    other_node = next(n for n in body["nodes"] if n["id"] == private_other.id)
    assert other_node["accessible"] is False
    assert other_node["name"] is None
    assert other_node["member_count"] is None
    assert other_node["role"] is None
    # Not expanded: only the two nodes should be present.
    assert {n["id"] for n in body["nodes"]} == {main.id, private_other.id}


def test_link_to_inaccessible_tree_accessible_via_shared_membership(client, db):
    owner = make_user(db, "alice")
    friend = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    shared_other = make_tree(db, friend, "Shared")
    share(db, shared_other, owner, "viewer")
    _link(db, main, "m1", shared_other)

    res = client.get(f"{API}/workspaces/{main.id}/link-graph", headers=auth(owner))
    assert res.status_code == 200
    body = res.json()
    other_node = next(n for n in body["nodes"] if n["id"] == shared_other.id)
    assert other_node["accessible"] is True
    assert other_node["name"] == "Shared"
    assert other_node["role"] == "viewer"


def test_multiple_links_between_same_pair_collapse_with_count(client, db):
    user = make_user(db, "alice")
    t1 = make_tree(db, user, "T1")
    t2 = make_tree(db, user, "T2")
    _link(db, t1, "m1", t2, last_name="One")
    _link(db, t1, "m2", t2, last_name="Two")

    res = client.get(f"{API}/workspaces/{t1.id}/link-graph", headers=auth(user))
    assert res.status_code == 200
    body = res.json()

    assert len(body["edges"]) == 1
    edge = body["edges"][0]
    assert edge["count"] == 2
    assert {bm["id"] for bm in edge["bridge_members"]} == {"m1", "m2"}


def test_non_readable_start_tree_returns_403(client, db):
    owner = make_user(db, "alice")
    stranger = make_user(db, "bob")
    tree = make_tree(db, owner, "Private")

    res = client.get(f"{API}/workspaces/{tree.id}/link-graph", headers=auth(stranger))
    assert res.status_code == 403


def test_missing_start_tree_returns_404(client, db):
    user = make_user(db, "alice")
    res = client.get(f"{API}/workspaces/does-not-exist/link-graph", headers=auth(user))
    assert res.status_code == 404


def test_no_linked_trees_returns_only_current_node(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "Solo")

    res = client.get(f"{API}/workspaces/{tree.id}/link-graph", headers=auth(user))
    assert res.status_code == 200
    body = res.json()
    assert len(body["nodes"]) == 1
    assert body["nodes"][0]["is_current"] is True
    assert body["edges"] == []
    assert body["truncated"] is False


def test_compute_link_graph_service_is_callable_without_a_route(db):
    """The traversal is a plain service function, not tied to the route."""
    owner = make_user(db, "alice")
    t1 = make_tree(db, owner, "T1")
    t2 = make_tree(db, owner, "T2")
    _link(db, t1, "m1", t2, last_name="One")

    out = compute_link_graph(db, t1, owner)

    assert {n.id for n in out.nodes} == {t1.id, t2.id}
    assert len(out.edges) == 1
    assert out.truncated is False
