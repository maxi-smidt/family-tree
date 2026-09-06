import pytest

from tests.conftest import API, add_member, auth, make_tree, make_user, share


def test_global_search_returns_owned_and_shared_trees_only(client, db):
    user = make_user(db, "alice")
    friend = make_user(db, "friend")
    stranger = make_user(db, "stranger")
    current_tree = make_tree(db, user, "Current")
    owned_tree = make_tree(db, user, "Owned")
    shared_tree = make_tree(db, friend, "Shared")
    private_tree = make_tree(db, stranger, "Private")
    share(db, shared_tree, user, "viewer")

    add_member(
        db,
        current_tree,
        "current-match",
        first_name="Maria",
        last_name="Current",
        gender="f",
    )
    add_member(
        db,
        owned_tree,
        "owned-match",
        first_name="Maria",
        last_name="Owned",
        gender="f",
    )
    add_member(
        db,
        shared_tree,
        "shared-match",
        first_name="Maria",
        last_name="Shared",
        gender="f",
    )
    add_member(
        db,
        private_tree,
        "private-match",
        first_name="Maria",
        last_name="Private",
        gender="f",
    )

    response = client.get(
        f"{API}/search?q=maria&exclude_workspace_id={current_tree.id}",
        headers=auth(user),
    )

    assert response.status_code == 200
    hits = response.json()
    assert {(hit["workspaceId"], hit["id"]) for hit in hits} == {
        (owned_tree.id, "owned-match"),
        (shared_tree.id, "shared-match"),
    }
    assert {hit["workspaceName"] for hit in hits} == {"Owned", "Shared"}
    assert all("additionalData" not in hit for hit in hits)


def test_global_search_applies_per_tree_and_overall_caps(client, db):
    user = make_user(db, "alice")
    alpha = make_tree(db, user, "Alpha")
    beta = make_tree(db, user, "Beta")
    for index in range(3):
        add_member(
            db,
            alpha,
            f"alpha-{index}",
            first_name="Maria",
            last_name=f"Alpha {index}",
            gender="f",
        )
        add_member(
            db,
            beta,
            f"beta-{index}",
            first_name="Maria",
            last_name=f"Beta {index}",
            gender="f",
        )

    response = client.get(
        f"{API}/search?q=maria&per_tree_limit=1&limit=2",
        headers=auth(user),
    )

    assert response.status_code == 200
    hits = response.json()
    assert len(hits) == 2
    assert {hit["workspaceId"] for hit in hits} == {alpha.id, beta.id}


def test_global_search_requires_authentication(client):
    response = client.get(f"{API}/search?q=maria")

    assert response.status_code == 401


def test_global_search_matches_name_permutation(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "Family")
    add_member(
        db,
        tree,
        "anna-mueller",
        first_name="Anna",
        last_name="Müller",
        date_of_birth="12 May 1932",
        gender="f",
    )
    add_member(
        db,
        tree,
        "anna-other",
        first_name="Anna",
        last_name="Müller",
        date_of_birth="1901",
        gender="f",
    )

    response = client.get(
        f"{API}/search",
        params={"q": "Müller Anna"},
        headers=auth(user),
    )
    assert response.status_code == 200
    assert {hit["id"] for hit in response.json()} == {"anna-mueller", "anna-other"}


@pytest.mark.parametrize(
    ("date_field", "year"),
    [("date_of_birth", "1932"), ("date_of_death", "1999")],
    ids=["birth_year", "death_year"],
)
def test_global_search_matches_year(client, db, date_field, year):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "Family")
    add_member(
        db,
        tree,
        "anna-mueller",
        first_name="Anna",
        last_name="Müller",
        gender="f",
        **{date_field: f"12 May {year}"},
    )
    add_member(
        db,
        tree,
        "anna-other",
        first_name="Anna",
        last_name="Müller",
        gender="f",
        **{date_field: "1901"},
    )

    response = client.get(
        f"{API}/search",
        params={"q": f"Anna Müller {year}"},
        headers=auth(user),
    )
    assert response.status_code == 200
    assert {hit["id"] for hit in response.json()} == {"anna-mueller"}
