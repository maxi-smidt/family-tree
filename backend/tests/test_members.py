from tests.conftest import API, auth, make_tree, make_user


def _create_member(client, tree, user, member_id, **kw):
    payload = {"id": member_id, "firstName": "Jo", "lastName": "Doe", "gender": "f"}
    payload.update(kw)
    return client.post(
        f"{API}/trees/{tree.id}/members", headers=auth(user), json=payload
    )


def test_member_crud_roundtrip(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    created = _create_member(
        client,
        tree,
        user,
        "m1",
        firstName="Ada",
        middleNames="Augusta",
        baptismalName="Augusta Ada",
    )
    assert created.status_code == 201
    assert created.json()["firstName"] == "Ada"
    assert created.json()["middleNames"] == "Augusta"
    assert created.json()["baptismalName"] == "Augusta Ada"

    updated = client.patch(
        f"{API}/trees/{tree.id}/members/m1",
        headers=auth(user),
        json={
            "middleNames": "Augusta Byron",
            "baptismalName": None,
            "lastName": "Lovelace",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["lastName"] == "Lovelace"
    assert updated.json()["middleNames"] == "Augusta Byron"
    assert updated.json()["baptismalName"] is None

    listed = client.get(f"{API}/trees/{tree.id}/members", headers=auth(user)).json()
    assert len(listed) == 1
    assert listed[0]["middleNames"] == "Augusta Byron"

    deleted = client.delete(
        f"{API}/trees/{tree.id}/members/m1", headers=auth(user)
    )
    assert deleted.status_code == 204
    assert client.get(f"{API}/trees/{tree.id}/members", headers=auth(user)).json() == []


def test_members_are_scoped_to_their_tree(client, db):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")
    _create_member(client, tree_a, user, "m1")

    # The member exists in tree A but must not be reachable through tree B.
    cross = client.patch(
        f"{API}/trees/{tree_b.id}/members/m1",
        headers=auth(user),
        json={"lastName": "X"},
    )
    assert cross.status_code == 404
    assert client.get(f"{API}/trees/{tree_b.id}/members", headers=auth(user)).json() == []


def test_bulk_position_update(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _create_member(client, tree, user, "m1")
    _create_member(client, tree, user, "m2")

    res = client.patch(
        f"{API}/trees/{tree.id}/members/positions",
        headers=auth(user),
        json=[
            {"id": "m1", "positionX": 100, "positionY": 200},
            {"id": "m2", "positionX": -50, "positionY": 75},
            {"id": "ghost", "positionX": 1, "positionY": 1},  # unknown id ignored
        ],
    )
    assert res.status_code == 204

    by_id = {
        m["id"]: m
        for m in client.get(
            f"{API}/trees/{tree.id}/members", headers=auth(user)
        ).json()
    }
    assert (by_id["m1"]["positionX"], by_id["m1"]["positionY"]) == (100, 200)
    assert (by_id["m2"]["positionX"], by_id["m2"]["positionY"]) == (-50, 75)


def test_relations_are_idempotent(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _create_member(client, tree, user, "child")
    _create_member(client, tree, user, "parent")

    body = {
        "from_member_id": "child",
        "to_member_id": "parent",
        "relation_type": "parent",
    }
    assert (
        client.post(
            f"{API}/trees/{tree.id}/relations", headers=auth(user), json=body
        ).status_code
        == 201
    )
    # Adding the same relation again must not create a duplicate.
    client.post(f"{API}/trees/{tree.id}/relations", headers=auth(user), json=body)
    relations = client.get(
        f"{API}/trees/{tree.id}/relations", headers=auth(user)
    ).json()
    assert len(relations) == 1


def test_relation_rejects_cross_tree_from_member(client, db):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")
    _create_member(client, tree_a, user, "m1")
    _create_member(client, tree_b, user, "m2")

    # m1 belongs to tree_a — must be rejected when used with tree_b
    res = client.post(
        f"{API}/trees/{tree_b.id}/relations",
        headers=auth(user),
        json={"from_member_id": "m1", "to_member_id": "m2", "relation_type": "parent"},
    )
    assert res.status_code == 404


def test_relation_rejects_cross_tree_to_member(client, db):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")
    _create_member(client, tree_a, user, "m1")
    _create_member(client, tree_b, user, "m2")

    # m2 belongs to tree_b — must be rejected when used with tree_a
    res = client.post(
        f"{API}/trees/{tree_a.id}/relations",
        headers=auth(user),
        json={"from_member_id": "m1", "to_member_id": "m2", "relation_type": "parent"},
    )
    assert res.status_code == 404


def test_relation_rejects_unknown_relation_type(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _create_member(client, tree, user, "m1")
    _create_member(client, tree, user, "m2")

    res = client.post(
        f"{API}/trees/{tree.id}/relations",
        headers=auth(user),
        json={"from_member_id": "m1", "to_member_id": "m2", "relation_type": "nope"},
    )
    assert res.status_code == 404


def test_relation_valid_path(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _create_member(client, tree, user, "m1")
    _create_member(client, tree, user, "m2")

    res = client.post(
        f"{API}/trees/{tree.id}/relations",
        headers=auth(user),
        json={"from_member_id": "m1", "to_member_id": "m2", "relation_type": "sibling"},
    )
    assert res.status_code == 201
    assert res.json()["from_member_id"] == "m1"
    assert res.json()["to_member_id"] == "m2"
    assert res.json()["relation_type"] == "sibling"


def test_surface_list_omits_detail_fields(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _create_member(
        client,
        tree,
        user,
        "m1",
        additionalData="some notes",
        birthplace="Berlin",
        hometown="Munich",
    )

    # With surface=true, detail fields should be absent/None
    res = client.get(
        f"{API}/trees/{tree.id}/members?surface=true", headers=auth(user)
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["additionalData"] is None
    assert data[0]["birthplace"] is None
    assert data[0]["hometown"] is None
    # Surface fields should be present
    assert data[0]["id"] == "m1"
    assert data[0]["firstName"] == "Jo"

    # Without surface param, detail fields should be present
    res2 = client.get(
        f"{API}/trees/{tree.id}/members", headers=auth(user)
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2) == 1
    assert data2[0]["additionalData"] == "some notes"
    assert data2[0]["birthplace"] == "Berlin"
    assert data2[0]["hometown"] == "Munich"


# ---------------------------------------------------------------------------
# Date sort-column tests
# ---------------------------------------------------------------------------

def test_create_member_populates_date_sort_columns(client, db):
    """Creating a member with dates must populate the *Sort columns in the response."""
    user = make_user(db, "alice-ds")
    tree = make_tree(db, user)

    res = _create_member(
        client, tree, user, "m-sort-1",
        dateOfBirth="1950-06-15",
        dateOfDeath="2020-03",
    )
    assert res.status_code == 201
    data = res.json()
    assert data["dateOfBirthSort"] == "1950-06-15"
    assert data["dateOfDeathSort"] == "2020-03-00"


def test_create_member_fuzzy_birth_date(client, db):
    """Fuzzy date strings should produce year-only sort keys."""
    user = make_user(db, "bob-ds")
    tree = make_tree(db, user)

    res = _create_member(
        client, tree, user, "m-sort-2",
        dateOfBirth="about 1850",
    )
    assert res.status_code == 201
    data = res.json()
    assert data["dateOfBirthSort"] == "1850-00-00"
    assert data["dateOfDeathSort"] is None


def test_update_member_refreshes_date_sort_columns(client, db):
    """Updating dates via PATCH must refresh the *Sort columns."""
    user = make_user(db, "carol-ds")
    tree = make_tree(db, user)

    _create_member(client, tree, user, "m-sort-3", dateOfBirth="1900")

    updated = client.patch(
        f"{API}/trees/{tree.id}/members/m-sort-3",
        headers=auth(user),
        json={"dateOfBirth": "1905-04-20", "dateOfDeath": "before 1970"},
    )
    assert updated.status_code == 200
    data = updated.json()
    assert data["dateOfBirthSort"] == "1905-04-20"
    assert data["dateOfDeathSort"] == "1970-00-00"


def test_surface_list_includes_date_sort_columns(client, db):
    """The surface=true endpoint must include the sort columns."""
    user = make_user(db, "dave-ds")
    tree = make_tree(db, user)

    _create_member(client, tree, user, "m-sort-4", dateOfBirth="15 JUN 1930")

    res = client.get(
        f"{API}/trees/{tree.id}/members?surface=true", headers=auth(user)
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["dateOfBirthSort"] == "1930-06-15"


def test_member_with_no_dates_has_null_sort_columns(client, db):
    """Members created without dates must have null sort columns."""
    user = make_user(db, "eve-ds")
    tree = make_tree(db, user)

    res = _create_member(client, tree, user, "m-sort-5")
    assert res.status_code == 201
    data = res.json()
    assert data["dateOfBirthSort"] is None
    assert data["dateOfDeathSort"] is None


def test_member_detail_endpoint(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _create_member(
        client,
        tree,
        user,
        "m1",
        additionalData="detailed notes",
        birthplace="Hamburg",
    )

    res = client.get(
        f"{API}/trees/{tree.id}/members/m1", headers=auth(user)
    )
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == "m1"
    assert data["additionalData"] == "detailed notes"
    assert data["birthplace"] == "Hamburg"
    assert data["firstName"] == "Jo"
