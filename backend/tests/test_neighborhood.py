"""Tests for the neighborhood BFS endpoint and member search."""

from tests.conftest import API, add_member, auth, make_tree, make_user


def _add_relation(client, tree, user, from_id, to_id, relation_type):
    return client.post(
        f"{API}/trees/{tree.id}/relations",
        headers=auth(user),
        json={
            "from_member_id": from_id,
            "to_member_id": to_id,
            "relation_type": relation_type,
        },
    )


def _setup_chain(db, client, user, tree, n=5):
    """Create a linear ancestor chain: m0 is child, m1 is parent of m0, etc."""
    for i in range(n):
        add_member(db, tree, f"m{i}", first_name=f"Person{i}", gender="f")
    for i in range(n - 1):
        _add_relation(client, tree, user, f"m{i}", f"m{i + 1}", "parent")
    return [f"m{i}" for i in range(n)]


# --- Neighborhood endpoint --------------------------------------------------


def test_neighborhood_returns_root_when_no_relations(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "solo", first_name="Solo", gender="m")

    r = client.get(
        f"{API}/trees/{tree.id}/members/neighborhood?root=solo",
        headers=auth(user),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["root_id"] == "solo"
    assert len(data["members"]) == 1
    assert data["truncated"] is False
    assert data["total_member_count"] == 1


def test_neighborhood_bfs_ancestors(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    # chain: m0 → m1 → m2 → m3 → m4 (m0 is youngest)
    _setup_chain(db, client, user, tree, n=5)

    # From m0 with up=2 we should get m0, m1 (parent), m2 (grandparent).
    r = client.get(
        f"{API}/trees/{tree.id}/members/neighborhood?root=m0&up=2&down=0&partners=false",
        headers=auth(user),
    )
    assert r.status_code == 200
    data = r.json()
    ids = {m["id"] for m in data["members"]}
    assert ids == {"m0", "m1", "m2"}
    assert data.get("truncated") is False or data.get("truncated") is False


def test_neighborhood_bfs_descendants(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _setup_chain(db, client, user, tree, n=5)

    # From m4 (oldest) with down=2 we should get m4, m3, m2.
    r = client.get(
        f"{API}/trees/{tree.id}/members/neighborhood?root=m4&up=0&down=2&partners=false",
        headers=auth(user),
    )
    assert r.status_code == 200
    data = r.json()
    ids = {m["id"] for m in data["members"]}
    assert ids == {"m4", "m3", "m2"}


def test_neighborhood_default_root(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _setup_chain(db, client, user, tree, n=4)

    # Without a root param the endpoint picks one automatically.
    r = client.get(
        f"{API}/trees/{tree.id}/members/neighborhood",
        headers=auth(user),
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data["members"]) >= 1
    assert data.get("root_id") is not None and data["root_id"] != ""


def test_neighborhood_empty_tree(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    r = client.get(
        f"{API}/trees/{tree.id}/members/neighborhood",
        headers=auth(user),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["members"] == []
    assert data.get("total_member_count", 0) == 0


def test_neighborhood_unknown_root_returns_404(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="Solo", gender="m")

    r = client.get(
        f"{API}/trees/{tree.id}/members/neighborhood?root=nonexistent",
        headers=auth(user),
    )
    assert r.status_code == 404


def test_neighborhood_includes_relations(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _setup_chain(db, client, user, tree, n=3)

    r = client.get(
        f"{API}/trees/{tree.id}/members/neighborhood?root=m0&up=2&down=0&partners=false",
        headers=auth(user),
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data["relations"]) == 2  # m0→m1 and m1→m2


def test_neighborhood_does_not_include_out_of_scope_relations(db, client):
    """Relations to members outside the neighborhood are excluded."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _setup_chain(db, client, user, tree, n=5)

    r = client.get(
        f"{API}/trees/{tree.id}/members/neighborhood?root=m0&up=1&down=0&partners=false",
        headers=auth(user),
    )
    assert r.status_code == 200
    data = r.json()
    ids = {m["id"] for m in data["members"]}
    assert "m2" not in ids
    for rel in data["relations"]:
        assert rel["from_member_id"] in ids
        assert rel["to_member_id"] in ids


# --- Search endpoint --------------------------------------------------------


def test_search_members_by_first_name(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="Johann", last_name="Bach", gender="m")
    add_member(db, tree, "m2", first_name="Carl", last_name="Bach", gender="m")
    add_member(db, tree, "m3", first_name="Maria", last_name="Mozart", gender="f")

    r = client.get(
        f"{API}/trees/{tree.id}/members/search?q=jo",
        headers=auth(user),
    )
    assert r.status_code == 200
    data = r.json()
    ids = {m["id"] for m in data}
    assert "m1" in ids
    assert "m2" not in ids
    assert "m3" not in ids


def test_search_members_by_last_name(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="Johann", last_name="Bach", gender="m")
    add_member(db, tree, "m2", first_name="Maria", last_name="Mozart", gender="f")

    r = client.get(
        f"{API}/trees/{tree.id}/members/search?q=bach",
        headers=auth(user),
    )
    assert r.status_code == 200
    data = r.json()
    ids = {m["id"] for m in data}
    assert "m1" in ids
    assert "m2" not in ids


def test_search_members_by_maiden_name(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(
        db, tree, "m1",
        first_name="Anna", last_name="Smith", maiden_name="Jones", gender="f",
    )
    add_member(db, tree, "m2", first_name="Bob", last_name="Smith", gender="m")

    r = client.get(
        f"{API}/trees/{tree.id}/members/search?q=jones",
        headers=auth(user),
    )
    assert r.status_code == 200
    data = r.json()
    ids = {m["id"] for m in data}
    assert "m1" in ids
    assert "m2" not in ids


def test_search_matches_first_last_and_last_first_order(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(
        db, tree, "m1",
        first_name="Anna", last_name="Müller", gender="f",
    )
    add_member(db, tree, "m2", first_name="Anna", last_name="Schmidt", gender="f")

    for query in ("Anna Müller", "Müller Anna"):
        r = client.get(
            f"{API}/trees/{tree.id}/members/search",
            params={"q": query},
            headers=auth(user),
        )
        assert r.status_code == 200
        ids = {m["id"] for m in r.json()}
        assert ids == {"m1"}, query


def test_search_matches_partial_tokens(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(
        db, tree, "m1",
        first_name="Anna", last_name="Müller", gender="f",
    )
    add_member(db, tree, "m2", first_name="Bob", last_name="Meyer", gender="m")

    for query in ("Müller Ann", "Anna Mü"):
        r = client.get(
            f"{API}/trees/{tree.id}/members/search",
            params={"q": query},
            headers=auth(user),
        )
        assert r.status_code == 200
        ids = {m["id"] for m in r.json()}
        assert ids == {"m1"}, query


def test_search_matches_name_combined_with_birth_year(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(
        db, tree, "m1",
        first_name="Anna", last_name="Müller",
        date_of_birth="12 May 1932", gender="f",
    )
    add_member(
        db, tree, "m2",
        first_name="Anna", last_name="Müller",
        date_of_birth="1901", gender="f",
    )

    for query in ("Anna Müller 1932", "1932 Anna"):
        r = client.get(
            f"{API}/trees/{tree.id}/members/search",
            params={"q": query},
            headers=auth(user),
        )
        assert r.status_code == 200
        ids = {m["id"] for m in r.json()}
        assert ids == {"m1"}, query


def test_search_year_token_requires_matching_name_token(db, client):
    """Multi-token queries AND across tokens: a year that matches a different
    member than the name token should exclude both."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(
        db, tree, "m1",
        first_name="Anna", last_name="Müller",
        date_of_birth="1901", gender="f",
    )
    add_member(
        db, tree, "m2",
        first_name="Bob", last_name="Schmidt",
        date_of_birth="1932", gender="m",
    )

    r = client.get(
        f"{API}/trees/{tree.id}/members/search",
        params={"q": "Anna 1932"},
        headers=auth(user),
    )
    assert r.status_code == 200
    assert r.json() == []


def test_search_single_token_behavior_unchanged(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="Johann", last_name="Bach", gender="m")

    r = client.get(
        f"{API}/trees/{tree.id}/members/search?q=jo",
        headers=auth(user),
    )
    assert r.status_code == 200
    ids = {m["id"] for m in r.json()}
    assert ids == {"m1"}


def test_search_empty_result(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="Anna", gender="f")

    r = client.get(
        f"{API}/trees/{tree.id}/members/search?q=zzznomatch",
        headers=auth(user),
    )
    assert r.status_code == 200
    assert r.json() == []


def test_search_limit_param(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    for i in range(10):
        add_member(db, tree, f"m{i}", first_name="Alice", gender="f")

    r = client.get(
        f"{API}/trees/{tree.id}/members/search?q=alice&limit=3",
        headers=auth(user),
    )
    assert r.status_code == 200
    assert len(r.json()) <= 3


def test_search_requires_query(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    r = client.get(
        f"{API}/trees/{tree.id}/members/search",
        headers=auth(user),
    )
    assert r.status_code == 422


def test_neighborhood_and_search_isolated_across_trees(db, client):
    """Endpoints must not leak data from other trees."""
    user = make_user(db, "alice")
    tree1 = make_tree(db, user, "Tree1")
    tree2 = make_tree(db, user, "Tree2")

    add_member(db, tree1, "t1m", first_name="Secret", gender="f")
    add_member(db, tree2, "t2m", first_name="Public", gender="f")

    search = client.get(
        f"{API}/trees/{tree2.id}/members/search?q=secret",
        headers=auth(user),
    )
    assert search.status_code == 200
    assert search.json() == []

    nb = client.get(
        f"{API}/trees/{tree2.id}/members/neighborhood?root=t1m",
        headers=auth(user),
    )
    assert nb.status_code == 404
