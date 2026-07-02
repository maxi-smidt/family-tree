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
        json={"from_member_id": "m1", "to_member_id": "m2", "relation_type": "other"},
    )
    assert res.status_code == 201
    assert res.json()["from_member_id"] == "m1"
    assert res.json()["to_member_id"] == "m2"
    assert res.json()["relation_type"] == "other"


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
        cemetery="Ohlsdorf Cemetery",
    )

    # With surface=true, the heavy detail field (additionalData) is omitted,
    # but birthplace/hometown/cemetery ride along so the List view can render
    # them.
    res = client.get(
        f"{API}/trees/{tree.id}/members?surface=true", headers=auth(user)
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["additionalData"] is None
    assert data[0]["birthplace"] == "Berlin"
    assert data[0]["hometown"] == "Munich"
    assert data[0]["cemetery"] == "Ohlsdorf Cemetery"
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
    assert data2[0]["cemetery"] == "Ohlsdorf Cemetery"


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
        cemetery="Ohlsdorf Cemetery",
    )

    res = client.get(
        f"{API}/trees/{tree.id}/members/m1", headers=auth(user)
    )
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == "m1"
    assert data["additionalData"] == "detailed notes"
    assert data["birthplace"] == "Hamburg"
    assert data["cemetery"] == "Ohlsdorf Cemetery"
    assert data["firstName"] == "Jo"


def test_link_member_to_accessible_tree(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(client, main, user, "m1")

    res = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"linkedTreeId": other.id},
    )
    assert res.status_code == 200
    assert res.json()["linkedTreeId"] == other.id

    # Clearing the link is allowed.
    cleared = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"linkedTreeId": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["linkedTreeId"] is None


def test_surface_list_includes_linked_tree_id(client, db):
    """The surface=true endpoint must include linkedTreeId so windowed/search
    views can render the linked-tree badge."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(client, main, user, "m1")

    linked = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"linkedTreeId": other.id},
    )
    assert linked.status_code == 200

    res = client.get(
        f"{API}/trees/{main.id}/members?surface=true", headers=auth(user)
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["id"] == "m1"
    assert data[0]["linkedTreeId"] == other.id


def test_cannot_link_member_to_own_tree(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")

    res = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"linkedTreeId": main.id},
    )
    assert res.status_code == 400


def test_cannot_link_member_to_inaccessible_tree(client, db):
    owner = make_user(db, "alice")
    stranger = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    private_other = make_tree(db, stranger, "Strangers")
    _create_member(client, main, owner, "m1")

    res = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(owner),
        json={"linkedTreeId": private_other.id},
    )
    assert res.status_code == 403


def test_create_member_subtree_seeds_bridge_person(client, db):
    """POST /members/{id}/subtree creates a new tree seeded with a copy of the
    member, linked bidirectionally via linkedTreeId + linkedMemberId."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(
        client, main, user, "m1",
        academicTitle="Dr.", deceased=True, birthplace="Vienna",
    )

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "Jo Doe family"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["tree"]["name"] == "Jo Doe family"
    new_tree_id = body["tree"]["id"]
    anchor = body["anchor"]
    assert anchor["linkedTreeId"] == new_tree_id
    assert anchor["linkedMemberId"] is not None

    # The new tree holds exactly one member: the cloned bridge person, linked
    # back to the origin row.
    members = client.get(
        f"{API}/trees/{new_tree_id}/members", headers=auth(user)
    ).json()
    assert len(members) == 1
    counterpart = members[0]
    assert counterpart["id"] == anchor["linkedMemberId"]
    assert counterpart["firstName"] == "Jo"
    assert counterpart["academicTitle"] == "Dr."
    assert counterpart["deceased"] is True
    assert counterpart["birthplace"] == "Vienna"
    assert counterpart["linkedTreeId"] == main.id
    assert counterpart["linkedMemberId"] == "m1"


def test_create_member_subtree_conflicts_when_already_linked(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")

    first = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "Sub"},
    )
    assert first.status_code == 201

    second = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "Sub 2"},
    )
    assert second.status_code == 409


def test_create_member_subtree_requires_name(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "   "},
    )
    assert res.status_code == 400


def test_linked_member_requires_linked_tree(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")
    _create_member(client, main, user, "m2")

    res = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"linkedMemberId": "m2"},
    )
    assert res.status_code == 400


def test_linked_member_must_belong_to_linked_tree(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(client, main, user, "m1")
    # m2 lives in *main*, not in the linked tree.
    _create_member(client, main, user, "m2")

    res = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"linkedTreeId": other.id, "linkedMemberId": "m2"},
    )
    assert res.status_code == 400


def test_unlinking_tree_clears_linked_member(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")

    created = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "Sub"},
    )
    assert created.status_code == 201

    cleared = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"linkedTreeId": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["linkedTreeId"] is None
    assert cleared.json()["linkedMemberId"] is None


def test_edit_member_with_unchanged_link_succeeds_when_flag_off(client, db):
    """The member form re-sends linkedTreeId unchanged on every save; once the
    tree_links flag is turned off that must not block ordinary edits."""
    from app.services import feature_service

    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")
    created = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "Sub"},
    )
    assert created.status_code == 201
    linked_tree_id = created.json()["tree"]["id"]

    feature_service.set_state(db, "tree_links", "off")
    db.commit()
    try:
        res = client.patch(
            f"{API}/trees/{main.id}/members/m1",
            headers=auth(user),
            json={"firstName": "Joanna", "linkedTreeId": linked_tree_id},
        )
        assert res.status_code == 200
        assert res.json()["firstName"] == "Joanna"
        # The link itself is untouched.
        assert res.json()["linkedTreeId"] == linked_tree_id
    finally:
        feature_service.set_state(db, "tree_links", "on")
        db.commit()


def test_bridge_person_edits_sync_to_counterpart(client, db):
    """Identity edits to either row of a bridge person propagate to the other."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")
    created = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "Sub"},
    )
    assert created.status_code == 201
    sub_tree_id = created.json()["tree"]["id"]
    counterpart_id = created.json()["anchor"]["linkedMemberId"]

    # Edit the anchor → counterpart follows.
    res = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"firstName": "Joanna", "deceased": True, "cemetery": "Ohlsdorf"},
    )
    assert res.status_code == 200
    counterpart = client.get(
        f"{API}/trees/{sub_tree_id}/members/{counterpart_id}", headers=auth(user)
    ).json()
    assert counterpart["firstName"] == "Joanna"
    assert counterpart["deceased"] is True
    assert counterpart["cemetery"] == "Ohlsdorf"

    # Edit the counterpart → anchor follows (the link is symmetric).
    res = client.patch(
        f"{API}/trees/{sub_tree_id}/members/{counterpart_id}",
        headers=auth(user),
        json={"lastName": "Smith"},
    )
    assert res.status_code == 200
    anchor = client.get(
        f"{API}/trees/{main.id}/members/m1", headers=auth(user)
    ).json()
    assert anchor["lastName"] == "Smith"
    # View-level state is NOT mirrored.
    res = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"isCollapsed": True, "positionX": 42.0},
    )
    assert res.status_code == 200
    counterpart = client.get(
        f"{API}/trees/{sub_tree_id}/members/{counterpart_id}", headers=auth(user)
    ).json()
    assert counterpart["isCollapsed"] is False
    assert counterpart["positionX"] == 0


def test_bridge_person_sync_skipped_when_flag_off(client, db):
    from app.services import feature_service

    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")
    created = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "Sub"},
    )
    sub_tree_id = created.json()["tree"]["id"]
    counterpart_id = created.json()["anchor"]["linkedMemberId"]

    feature_service.set_state(db, "tree_links", "off")
    db.commit()
    try:
        res = client.patch(
            f"{API}/trees/{main.id}/members/m1",
            headers=auth(user),
            json={"firstName": "Joanna"},
        )
        assert res.status_code == 200
        counterpart = client.get(
            f"{API}/trees/{sub_tree_id}/members/{counterpart_id}",
            headers=auth(user),
        ).json()
        # Feature dormant: the rows drift instead of syncing.
        assert counterpart["firstName"] == "Jo"
    finally:
        feature_service.set_state(db, "tree_links", "on")
        db.commit()


def test_bridge_person_sync_requires_write_access_to_other_tree(client, db):
    """An editor of one side without write access to the other side may still
    edit — the counterpart simply doesn't update."""
    from tests.conftest import share

    owner = make_user(db, "alice")
    editor = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    _create_member(client, main, owner, "m1")
    created = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(owner),
        json={"name": "Sub"},
    )
    sub_tree_id = created.json()["tree"]["id"]
    counterpart_id = created.json()["anchor"]["linkedMemberId"]
    # bob may edit Main but has no access to Sub at all.
    share(db, main, editor, "editor")

    res = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(editor),
        json={"firstName": "Joanna"},
    )
    assert res.status_code == 200
    counterpart = client.get(
        f"{API}/trees/{sub_tree_id}/members/{counterpart_id}",
        headers=auth(owner),
    ).json()
    assert counterpart["firstName"] == "Jo"
