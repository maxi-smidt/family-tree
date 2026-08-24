"""Section filters, node budgets, and continuation cursors (#983)."""

from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _relate(client, tree, user, from_id, to_id, relation_type="parent"):
    r = client.post(
        f"{API}/workspaces/{tree.id}/relations",
        headers=auth(user),
        json={
            "from_member_id": from_id,
            "to_member_id": to_id,
            "relation_type": relation_type,
        },
    )
    assert r.status_code in (200, 201), r.text
    return r


def _chain(db, client, user, tree, n=5):
    """m0 → m1 → m2 … (from=child, to=parent), so m0 is the youngest."""
    for i in range(n):
        add_member(db, tree, f"m{i}", first_name=f"Person{i}")
    for i in range(n - 1):
        _relate(client, tree, user, f"m{i}", f"m{i + 1}")
    return [f"m{i}" for i in range(n)]


def _section(client, tree, user, name, member_ids):
    r = client.post(
        f"{API}/workspaces/{tree.id}/sections", headers=auth(user), json={"name": name}
    )
    assert r.status_code == 201, r.text
    section_id = r.json()["id"]
    r = client.put(
        f"{API}/workspaces/{tree.id}/sections/{section_id}/members",
        headers=auth(user),
        json={"member_ids": member_ids},
    )
    assert r.status_code == 204, r.text
    return section_id


def _neighborhood(client, tree, user, **params):
    r = client.get(
        f"{API}/workspaces/{tree.id}/members/neighborhood",
        headers=auth(user) if user else {},
        params={"partners": "false", **params},
    )
    return r


# --- Section filters --------------------------------------------------------


def test_section_filter_bounds_the_traversal(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=5)
    section_id = _section(client, tree, user, "Branch", ["m0", "m1", "m2"])

    r = _neighborhood(client, tree, user, root="m0", up=4, down=0, sections=[section_id])
    assert r.status_code == 200
    assert {m["id"] for m in r.json()["members"]} == {"m0", "m1", "m2"}


def test_section_filter_from_another_workspace_matches_nothing(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    other = make_tree(db, user, name="Other")
    add_member(db, other, "x0")
    foreign = _section(client, other, user, "Foreign", ["x0"])
    _chain(db, client, user, tree, n=3)

    # A filter naming nothing this workspace knows must not widen back out to
    # the unfiltered view.
    r = _neighborhood(client, tree, user, root="m0", up=2, down=0, sections=[foreign])
    assert r.status_code == 200
    assert {m["id"] for m in r.json()["members"]} == {"m0"}


def test_default_root_is_picked_inside_the_section_filter(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=5)
    # m0 is the most-connected member overall, but is not in this section.
    section_id = _section(client, tree, user, "Elders", ["m3", "m4"])

    r = _neighborhood(client, tree, user, up=4, down=4, sections=[section_id])
    assert r.status_code == 200
    assert r.json()["root_id"] == "m3"


# --- Budget and cursor paging ----------------------------------------------


def test_cursor_pages_cover_the_neighborhood_exactly_once(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    ids = _chain(db, client, user, tree, n=5)

    collected: list[str] = []
    cursor = None
    for _ in range(5):
        params = {"root": "m0", "up": 4, "down": 0, "budget": 2}
        if cursor:
            params["cursor"] = cursor
        r = _neighborhood(client, tree, user, **params)
        assert r.status_code == 200
        data = r.json()
        collected.extend(m["id"] for m in data["members"])
        cursor = data["next_cursor"]
        if cursor is None:
            break

    assert cursor is None
    assert collected == sorted(ids)
    assert len(collected) == len(set(collected))


def test_last_page_reports_no_truncation(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=3)

    r = _neighborhood(client, tree, user, root="m0", up=2, down=0, budget=2)
    data = r.json()
    assert data["truncated"] is True
    assert data["next_cursor"] is not None

    r = _neighborhood(
        client, tree, user, root="m0", up=2, down=0, budget=2, cursor=data["next_cursor"]
    )
    data = r.json()
    assert [m["id"] for m in data["members"]] == ["m2"]
    assert data["truncated"] is False
    assert data["next_cursor"] is None


def test_relations_to_earlier_pages_are_included(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=4)

    r = _neighborhood(client, tree, user, root="m0", up=3, down=0, budget=2)
    cursor = r.json()["next_cursor"]
    r = _neighborhood(
        client, tree, user, root="m0", up=3, down=0, budget=2, cursor=cursor
    )
    # m1 → m2 crosses the page boundary and must still be drawable.
    edges = {
        (rel["from_member_id"], rel["to_member_id"]) for rel in r.json()["relations"]
    }
    assert ("m1", "m2") in edges


def test_replaying_a_cursor_is_idempotent(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=5)

    cursor = _neighborhood(client, tree, user, root="m0", up=4, down=0, budget=2).json()[
        "next_cursor"
    ]
    first = _neighborhood(
        client, tree, user, root="m0", up=4, down=0, budget=2, cursor=cursor
    ).json()
    second = _neighborhood(
        client, tree, user, root="m0", up=4, down=0, budget=2, cursor=cursor
    ).json()
    assert [m["id"] for m in first["members"]] == [m["id"] for m in second["members"]]


# --- Cursor binding ---------------------------------------------------------


def test_malformed_cursor_is_rejected(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=3)

    r = _neighborhood(client, tree, user, root="m0", up=2, down=0, cursor="not-a-cursor")
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid or expired cursor"


def test_cursor_is_bound_to_the_request_parameters(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=5)

    cursor = _neighborhood(client, tree, user, root="m0", up=4, down=0, budget=2).json()[
        "next_cursor"
    ]
    r = _neighborhood(
        client, tree, user, root="m0", up=2, down=0, budget=2, cursor=cursor
    )
    assert r.status_code == 400


def test_cursor_from_another_workspace_is_rejected(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    other = make_tree(db, user, name="Other")
    _chain(db, client, user, tree, n=5)
    for i in range(5):
        add_member(db, other, f"o{i}")

    cursor = _neighborhood(client, tree, user, root="m0", up=4, down=0, budget=2).json()[
        "next_cursor"
    ]
    r = _neighborhood(
        client, other, user, root="o0", up=4, down=0, budget=2, cursor=cursor
    )
    assert r.status_code == 400


def test_cursor_from_another_principal_is_rejected(db, client):
    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, viewer, role="viewer")
    _chain(db, client, owner, tree, n=5)

    cursor = _neighborhood(client, tree, owner, root="m0", up=4, down=0, budget=2).json()[
        "next_cursor"
    ]
    r = _neighborhood(
        client, tree, viewer, root="m0", up=4, down=0, budget=2, cursor=cursor
    )
    assert r.status_code == 400


def test_cursor_goes_stale_when_the_graph_changes(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=5)

    cursor = _neighborhood(client, tree, user, root="m0", up=4, down=0, budget=2).json()[
        "next_cursor"
    ]
    add_member(db, tree, "newcomer")

    r = _neighborhood(
        client, tree, user, root="m0", up=4, down=0, budget=2, cursor=cursor
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "stale_cursor"


# --- Continuations ----------------------------------------------------------


def test_continuation_reports_workspace_members_not_yet_loaded(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=5)

    data = _neighborhood(client, tree, user, root="m0", up=4, down=0, budget=2).json()
    assert data["continuations"] == [
        {"section_id": None, "section_name": None, "remaining_count": 3}
    ]


def test_continuation_reports_remaining_members_per_section(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=5)
    section_id = _section(client, tree, user, "North America", ["m0", "m1", "m2", "m3"])

    data = _neighborhood(
        client, tree, user, root="m0", up=4, down=0, budget=2, sections=[section_id]
    ).json()
    assert data["continuations"] == [
        {
            "section_id": section_id,
            "section_name": "North America",
            "remaining_count": 2,
        }
    ]


def test_fully_loaded_neighborhood_reports_no_continuation(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=3)

    data = _neighborhood(client, tree, user, root="m0", up=2, down=0).json()
    assert data["continuations"] == []
    assert data["next_cursor"] is None


def test_empty_section_filter_still_reports_the_workspace_size(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=3)
    section_id = _section(client, tree, user, "Nobody", [])

    data = _neighborhood(client, tree, user, sections=[section_id]).json()
    assert data["members"] == []
    assert data["total_member_count"] == 3


def test_unreachable_members_do_not_produce_a_continuation(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=2)
    add_member(db, tree, "loner")

    data = _neighborhood(client, tree, user, root="m0", up=5, down=5).json()
    # The traversal is complete; "1 more" the cursor chain could never deliver
    # would just be a dead load-more button.
    assert data["truncated"] is False
    assert data["continuations"] == []


def test_public_callers_get_no_section_continuations(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=5)
    section_id = _section(client, tree, user, "Secret Branch", ["m0", "m1", "m2", "m3"])
    client.patch(
        f"{API}/workspaces/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(user),
    )

    data = _neighborhood(
        client, tree, None, root="m0", up=4, down=0, budget=2, sections=[section_id]
    ).json()
    assert data["truncated"] is True
    assert data["continuations"] == []


def test_each_relation_is_sent_once_across_the_cursor_chain(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=8)

    seen: list[tuple[str, str]] = []
    cursor = None
    while True:
        params = {"root": "m0", "up": 7, "down": 0, "budget": 2}
        if cursor:
            params["cursor"] = cursor
        data = _neighborhood(client, tree, user, **params).json()
        seen.extend(
            (rel["from_member_id"], rel["to_member_id"]) for rel in data["relations"]
        )
        cursor = data["next_cursor"]
        if cursor is None:
            break

    assert sorted(seen) == [(f"m{i}", f"m{i + 1}") for i in range(7)]


def test_default_root_ignores_how_many_sections_a_member_is_in(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    for member_id in ("hub", "a", "b", "c", "dup", "z"):
        add_member(db, tree, member_id)
    for child in ("a", "b", "c"):
        _relate(client, tree, user, child, "hub")
    _relate(client, tree, user, "dup", "z")

    everyone = _section(
        client, tree, user, "Everyone", ["hub", "a", "b", "c", "dup", "z"]
    )
    extras = [_section(client, tree, user, name, ["dup"]) for name in ("B", "C", "D")]

    # "dup" has one relation but four section memberships; "a" has one relation
    # and one. Neither may outrank a member with more actual connections.
    data = _neighborhood(client, tree, user, sections=[everyone, *extras]).json()
    assert data["root_id"] in {"a", "b", "c"}


def test_changing_the_focus_root_asks_for_a_restart(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _chain(db, client, user, tree, n=5)

    cursor = _neighborhood(client, tree, user, root="m0", up=4, down=0, budget=2).json()[
        "next_cursor"
    ]
    r = _neighborhood(
        client, tree, user, root="m1", up=4, down=0, budget=2, cursor=cursor
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "stale_cursor"
