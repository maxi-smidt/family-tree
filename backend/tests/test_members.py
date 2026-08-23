from app.models import Event, EventMemberLink, Relation
from tests.conftest import API, add_member, auth, make_tree, make_user


def _create_member(client, tree, user, member_id, **kw):
    payload = {"id": member_id, "firstName": "Jo", "lastName": "Doe", "gender": "f"}
    payload.update(kw)
    return client.post(f"{API}/trees/{tree.id}/members", headers=auth(user), json=payload)


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

    deleted = client.delete(f"{API}/trees/{tree.id}/members/m1", headers=auth(user))
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


def test_member_update_atomically_replaces_parent_and_vital_event(client, db):
    user = make_user(db, "atomic")
    tree = make_tree(db, user)
    child = add_member(db, tree, "child", first_name="Before", last_name="Child")
    old_parent = add_member(db, tree, "old-parent", gender="m")
    new_parent = add_member(db, tree, "new-parent", gender="m")
    db.add(
        Relation(
            tree_id=tree.id,
            from_member_id=child.id,
            to_member_id=old_parent.id,
            relation_type="parent",
        )
    )
    event = Event(
        id="birth-event",
        tree_id=tree.id,
        event_type="birth",
        date="1900",
        location="Vienna",
        description="Certificate details",
        created_at="2024-01-01T00:00:00Z",
    )
    db.add(event)
    db.add(EventMemberLink(event_id=event.id, member_id=child.id))
    db.commit()

    payload = {
        "lastName": "Updated",
        "paternalParentId": new_parent.id,
        "dateOfBirth": "1901-02-03",
    }
    response = client.patch(
        f"{API}/trees/{tree.id}/members/{child.id}",
        headers=auth(user),
        json=payload,
    )
    assert response.status_code == 200

    db.expire_all()
    assert db.get(type(child), child.id).last_name == "Updated"
    relations = (
        db.query(Relation).filter_by(tree_id=tree.id, relation_type="parent").all()
    )
    assert [
        (relation.from_member_id, relation.to_member_id) for relation in relations
    ] == [(child.id, new_parent.id)]
    saved_event = db.get(Event, event.id)
    assert saved_event.date == "1901-02-03"
    assert saved_event.location == "Vienna"
    assert saved_event.description == "Certificate details"

    # Retrying the same autosave is idempotent.
    assert (
        client.patch(
            f"{API}/trees/{tree.id}/members/{child.id}",
            headers=auth(user),
            json=payload,
        ).status_code
        == 200
    )
    assert (
        db.query(Relation).filter_by(tree_id=tree.id, relation_type="parent").count() == 1
    )
    assert db.query(Event).filter_by(tree_id=tree.id, event_type="birth").count() == 1


def test_member_update_creates_birth_event_seeded_with_birthplace(client, db):
    user = make_user(db, "seed-birth")
    tree = make_tree(db, user)
    member = add_member(db, tree, "m1", first_name="Ada", last_name="Lovelace")

    response = client.patch(
        f"{API}/trees/{tree.id}/members/{member.id}",
        headers=auth(user),
        json={"dateOfBirth": "1815-12-10", "birthplace": "London"},
    )
    assert response.status_code == 200

    event = db.query(Event).filter_by(tree_id=tree.id, event_type="birth").one()
    assert event.date == "1815-12-10"
    assert event.location == "London"


def test_member_update_creates_death_event_seeded_with_cemetery(client, db):
    user = make_user(db, "seed-death")
    tree = make_tree(db, user)
    member = add_member(db, tree, "m1", first_name="Ada", last_name="Lovelace")

    response = client.patch(
        f"{API}/trees/{tree.id}/members/{member.id}",
        headers=auth(user),
        json={"dateOfDeath": "1852-11-27", "cemetery": "Hucknall Torkard"},
    )
    assert response.status_code == 200

    event = db.query(Event).filter_by(tree_id=tree.id, event_type="death").one()
    assert event.date == "1852-11-27"
    assert event.location == "Hucknall Torkard"


def test_member_update_backfills_empty_event_location_from_birthplace(client, db):
    user = make_user(db, "backfill")
    tree = make_tree(db, user)
    member = add_member(
        db, tree, "m1", first_name="Ada", last_name="Lovelace", date_of_birth="1815"
    )
    event = Event(
        id="birth-event",
        tree_id=tree.id,
        event_type="birth",
        date="1815",
        location=None,
        created_at="2024-01-01T00:00:00Z",
    )
    db.add(event)
    db.add(EventMemberLink(event_id=event.id, member_id=member.id))
    db.commit()

    # Only birthplace changes — the date is untouched.
    response = client.patch(
        f"{API}/trees/{tree.id}/members/{member.id}",
        headers=auth(user),
        json={"birthplace": "London"},
    )
    assert response.status_code == 200

    db.expire_all()
    saved_event = db.get(Event, event.id)
    assert saved_event.date == "1815"
    assert saved_event.location == "London"


def test_member_update_does_not_overwrite_user_authored_event_location(client, db):
    user = make_user(db, "preserve")
    tree = make_tree(db, user)
    member = add_member(
        db, tree, "m1", first_name="Ada", last_name="Lovelace", date_of_birth="1815"
    )
    event = Event(
        id="birth-event",
        tree_id=tree.id,
        event_type="birth",
        date="1815",
        location="Vienna",
        created_at="2024-01-01T00:00:00Z",
    )
    db.add(event)
    db.add(EventMemberLink(event_id=event.id, member_id=member.id))
    db.commit()

    response = client.patch(
        f"{API}/trees/{tree.id}/members/{member.id}",
        headers=auth(user),
        json={"birthplace": "London"},
    )
    assert response.status_code == 200

    db.expire_all()
    saved_event = db.get(Event, event.id)
    assert saved_event.location == "Vienna"


def test_member_update_rolls_back_when_a_parent_is_invalid(client, db):
    user = make_user(db, "rollback")
    tree = make_tree(db, user)
    child = add_member(db, tree, "child", last_name="Before")
    old_parent = add_member(db, tree, "old-parent", gender="m")
    db.add(
        Relation(
            tree_id=tree.id,
            from_member_id=child.id,
            to_member_id=old_parent.id,
            relation_type="parent",
        )
    )
    db.commit()

    response = client.patch(
        f"{API}/trees/{tree.id}/members/{child.id}",
        headers=auth(user),
        json={
            "lastName": "Must not persist",
            "paternalParentId": "missing-parent",
            "dateOfBirth": "1901",
        },
    )
    assert response.status_code == 404

    db.expire_all()
    assert db.get(type(child), child.id).last_name == "Before"
    assert (
        db.query(Relation)
        .filter_by(tree_id=tree.id, from_member_id=child.id, to_member_id=old_parent.id)
        .count()
        == 1
    )
    assert db.query(Event).filter_by(tree_id=tree.id, event_type="birth").count() == 0


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
        for m in client.get(f"{API}/trees/{tree.id}/members", headers=auth(user)).json()
    }
    assert (by_id["m1"]["positionX"], by_id["m1"]["positionY"]) == (100, 200)
    assert (by_id["m2"]["positionX"], by_id["m2"]["positionY"]) == (-50, 75)


def test_create_member_trims_whitespace(client, db):
    user = make_user(db, "trimmer")
    tree = make_tree(db, user)

    created = _create_member(
        client,
        tree,
        user,
        "m1",
        firstName="  Ada  ",
        lastName="  Lovelace ",
        middleNames=" Augusta Byron ",
        birthplace="  London ",
    )
    assert created.status_code == 201
    body = created.json()
    assert body["firstName"] == "Ada"
    assert body["lastName"] == "Lovelace"
    assert body["middleNames"] == "Augusta Byron"
    assert body["birthplace"] == "London"

    listed = client.get(f"{API}/trees/{tree.id}/members", headers=auth(user)).json()
    assert listed[0]["firstName"] == "Ada"
    assert listed[0]["lastName"] == "Lovelace"


def test_update_member_trims_whitespace(client, db):
    user = make_user(db, "trimmer2")
    tree = make_tree(db, user)
    _create_member(client, tree, user, "m1")

    updated = client.patch(
        f"{API}/trees/{tree.id}/members/m1",
        headers=auth(user),
        json={
            "lastName": "  Lovelace  ",
            "middleNames": " Augusta Byron ",
            "cemetery": "  Kensal Green  ",
        },
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["lastName"] == "Lovelace"
    assert body["middleNames"] == "Augusta Byron"
    assert body["cemetery"] == "Kensal Green"

    fetched = client.get(f"{API}/trees/{tree.id}/members", headers=auth(user)).json()
    assert fetched[0]["lastName"] == "Lovelace"


def test_update_member_whitespace_only_field_trims_to_empty_string(client, db):
    user = make_user(db, "trimmer3")
    tree = make_tree(db, user)
    _create_member(client, tree, user, "m1")

    updated = client.patch(
        f"{API}/trees/{tree.id}/members/m1",
        headers=auth(user),
        json={"middleNames": "   "},
    )
    assert updated.status_code == 200
    assert updated.json()["middleNames"] == ""


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
    relations = client.get(f"{API}/trees/{tree.id}/relations", headers=auth(user)).json()
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
    res = client.get(f"{API}/trees/{tree.id}/members?surface=true", headers=auth(user))
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
    res2 = client.get(f"{API}/trees/{tree.id}/members", headers=auth(user))
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
        client,
        tree,
        user,
        "m-sort-1",
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
        client,
        tree,
        user,
        "m-sort-2",
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

    res = client.get(f"{API}/trees/{tree.id}/members?surface=true", headers=auth(user))
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

    res = client.get(f"{API}/trees/{tree.id}/members/m1", headers=auth(user))
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == "m1"
    assert data["additionalData"] == "detailed notes"
    assert data["birthplace"] == "Hamburg"
    assert data["cemetery"] == "Ohlsdorf Cemetery"
    assert data["firstName"] == "Jo"


def test_link_member_to_accessible_tree(client, db):
    """Establishing a link through the dedicated endpoint wires a bridge
    person; clearing it via PATCH is still allowed."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(client, main, user, "m1")

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={"linkedTreeId": other.id, "mode": "create"},
    )
    assert res.status_code == 201
    assert res.json()["anchor"]["linkedTreeId"] == other.id

    # Clearing the link is allowed via PATCH.
    cleared = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"linkedTreeId": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["linkedTreeId"] is None


def test_patch_cannot_establish_a_link(client, db):
    """The loophole this issue closes: PATCH may only clear or leave a link
    unchanged, never establish a new one."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(client, main, user, "m1")

    res = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"linkedTreeId": other.id},
    )
    assert res.status_code == 400


def test_create_member_cannot_set_a_link(client, db):
    """A brand-new member cannot arrive pre-linked; that would require writing
    a row in another tree, which only the link endpoint may do."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")

    res = _create_member(client, main, user, "m1", linkedTreeId=other.id)
    assert res.status_code == 400


def test_surface_list_includes_linked_tree_id(client, db):
    """The surface=true endpoint must include linkedTreeId so windowed/search
    views can render the linked-tree badge."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(client, main, user, "m1")

    linked = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={"linkedTreeId": other.id, "mode": "create"},
    )
    assert linked.status_code == 201

    res = client.get(f"{API}/trees/{main.id}/members?surface=true", headers=auth(user))
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["id"] == "m1"
    assert data[0]["linkedTreeId"] == other.id


def test_cannot_link_member_to_own_tree(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={"linkedTreeId": main.id, "mode": "create"},
    )
    assert res.status_code == 400


def test_cannot_link_member_to_inaccessible_tree(client, db):
    owner = make_user(db, "alice")
    stranger = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    private_other = make_tree(db, stranger, "Strangers")
    _create_member(client, main, owner, "m1")

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(owner),
        json={"linkedTreeId": private_other.id, "mode": "create"},
    )
    assert res.status_code == 403


def test_cannot_link_to_tree_without_write_access(client, db):
    """Read access to the target is not enough: establishing a bridge writes
    the counterpart row too, so write access to B is required."""
    from tests.conftest import share

    owner = make_user(db, "alice")
    viewer_owner = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    viewable_only = make_tree(db, viewer_owner, "Viewable")
    _create_member(client, main, owner, "m1")
    share(db, viewable_only, owner, "viewer")

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(owner),
        json={"linkedTreeId": viewable_only.id, "mode": "create"},
    )
    assert res.status_code == 403


def test_create_member_subtree_seeds_bridge_person(client, db):
    """POST /members/{id}/subtree creates a new tree seeded with a copy of the
    member, linked bidirectionally via linkedTreeId + linkedMemberId."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(
        client,
        main,
        user,
        "m1",
        academicTitle="Dr.",
        deceased=True,
        birthplace="Vienna",
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
    members = client.get(f"{API}/trees/{new_tree_id}/members", headers=auth(user)).json()
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


# --- POST /members/{id}/link ------------------------------------------------
def test_link_mode_create_seeds_and_wires_bridge(client, db):
    """mode="create" clones the member into B and wires both rows, same as
    the create-linked-subtree flow but for an already-existing target tree."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(
        client,
        main,
        user,
        "m1",
        academicTitle="Dr.",
        deceased=True,
        birthplace="Vienna",
    )

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={"linkedTreeId": other.id, "mode": "create"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["tree"]["id"] == other.id
    anchor = body["anchor"]
    assert anchor["linkedTreeId"] == other.id
    assert anchor["linkedMemberId"] is not None

    members = client.get(f"{API}/trees/{other.id}/members", headers=auth(user)).json()
    assert len(members) == 1
    counterpart = members[0]
    assert counterpart["id"] == anchor["linkedMemberId"]
    assert counterpart["firstName"] == "Jo"
    assert counterpart["academicTitle"] == "Dr."
    assert counterpart["deceased"] is True
    assert counterpart["birthplace"] == "Vienna"
    assert counterpart["linkedTreeId"] == main.id
    assert counterpart["linkedMemberId"] == "m1"


def test_link_mode_existing_wires_without_copying_identity(client, db):
    """mode="existing" wires the two rows bidirectionally but leaves the
    counterpart's own identity fields untouched — the user asserts sameness,
    drift is resolved separately via bridge-sync."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(client, main, user, "m1", firstName="Jo", lastName="Doe")
    _create_member(
        client, other, user, "counterpart", firstName="Josephine", lastName="Dupont"
    )

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={
            "linkedTreeId": other.id,
            "mode": "existing",
            "counterpartMemberId": "counterpart",
        },
    )
    assert res.status_code == 201
    body = res.json()
    anchor = body["anchor"]
    assert anchor["linkedTreeId"] == other.id
    assert anchor["linkedMemberId"] == "counterpart"

    counterpart = client.get(
        f"{API}/trees/{other.id}/members/counterpart", headers=auth(user)
    ).json()
    assert counterpart["linkedTreeId"] == main.id
    assert counterpart["linkedMemberId"] == "m1"
    # Identity fields were NOT copied over.
    assert counterpart["firstName"] == "Josephine"
    assert counterpart["lastName"] == "Dupont"


def test_link_endpoint_requires_write_access_to_target(client, db):
    from tests.conftest import share

    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    other = make_tree(db, owner, "Other")
    _create_member(client, main, owner, "m1")
    share(db, main, viewer, "editor")
    share(db, other, viewer, "viewer")

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(viewer),
        json={"linkedTreeId": other.id, "mode": "create"},
    )
    assert res.status_code == 403


def test_link_endpoint_conflicts_when_source_already_linked(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other_b = make_tree(db, user, "B")
    other_c = make_tree(db, user, "C")
    _create_member(client, main, user, "m1")

    first = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={"linkedTreeId": other_b.id, "mode": "create"},
    )
    assert first.status_code == 201

    second = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={"linkedTreeId": other_c.id, "mode": "create"},
    )
    assert second.status_code == 409


def test_link_endpoint_rejects_counterpart_not_in_target_tree(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    unrelated = make_tree(db, user, "Unrelated")
    _create_member(client, main, user, "m1")
    _create_member(client, unrelated, user, "elsewhere")

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={
            "linkedTreeId": other.id,
            "mode": "existing",
            "counterpartMemberId": "elsewhere",
        },
    )
    assert res.status_code == 400


def test_link_endpoint_rejects_counterpart_already_linked(client, db):
    """Prevents hijacking another link's bridge person."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    third = make_tree(db, user, "Third")
    _create_member(client, main, user, "m1")
    _create_member(client, other, user, "m2")

    # m2 is already the bridge counterpart of some other link.
    seed = client.post(
        f"{API}/trees/{other.id}/members/m2/link",
        headers=auth(user),
        json={"linkedTreeId": third.id, "mode": "create"},
    )
    assert seed.status_code == 201

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={
            "linkedTreeId": other.id,
            "mode": "existing",
            "counterpartMemberId": "m2",
        },
    )
    assert res.status_code == 400


def test_link_endpoint_rejects_self_as_counterpart(client, db):
    """A member's own tree is already rejected by the not-self tree check
    (_validate_linked_tree), so this can only be reached with linkedTreeId
    pointed elsewhere while counterpartMemberId names the source member
    itself — still correctly refused as "not part of the linked tree"."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(client, main, user, "m1")

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={
            "linkedTreeId": other.id,
            "mode": "existing",
            "counterpartMemberId": "m1",
        },
    )
    assert res.status_code == 400


def test_link_endpoint_pairwise_chain_is_independent(client, db):
    """A -> B and B -> C are independent pairwise links; no chain/global
    consistency is enforced, and each bridge is self-contained."""
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")
    tree_c = make_tree(db, user, "C")
    _create_member(client, tree_a, user, "a1")
    _create_member(client, tree_b, user, "b1")

    ab = client.post(
        f"{API}/trees/{tree_a.id}/members/a1/link",
        headers=auth(user),
        json={"linkedTreeId": tree_b.id, "mode": "create"},
    )
    assert ab.status_code == 201

    bc = client.post(
        f"{API}/trees/{tree_b.id}/members/b1/link",
        headers=auth(user),
        json={"linkedTreeId": tree_c.id, "mode": "create"},
    )
    assert bc.status_code == 201

    a1 = client.get(f"{API}/trees/{tree_a.id}/members/a1", headers=auth(user)).json()
    b1 = client.get(f"{API}/trees/{tree_b.id}/members/b1", headers=auth(user)).json()
    assert a1["linkedTreeId"] == tree_b.id
    assert b1["linkedTreeId"] == tree_c.id
    # b1 is now a bridge counterpart for A→B and cannot be reused as a
    # counterpart for a fresh link.
    _create_member(client, tree_c, user, "c1")
    reuse = client.post(
        f"{API}/trees/{tree_c.id}/members/c1/link",
        headers=auth(user),
        json={
            "linkedTreeId": tree_b.id,
            "mode": "existing",
            "counterpartMemberId": "b1",
        },
    )
    assert reuse.status_code == 400


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


def test_link_existing_counterpart_must_belong_to_linked_tree(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(client, main, user, "m1")
    # m2 lives in *main*, not in the linked tree.
    _create_member(client, main, user, "m2")

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={
            "linkedTreeId": other.id,
            "mode": "existing",
            "counterpartMemberId": "m2",
        },
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
    sub_id = created.json()["tree"]["id"]
    counterpart_id = created.json()["anchor"]["linkedMemberId"]

    cleared = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"linkedTreeId": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["linkedTreeId"] is None
    assert cleared.json()["linkedMemberId"] is None

    # A bridge is symmetric: unlinking from one side must also clear the
    # counterpart in the other tree, otherwise the link lingers there and
    # identity edits keep syncing one-directionally.
    counterpart = client.get(
        f"{API}/trees/{sub_id}/members/{counterpart_id}", headers=auth(user)
    ).json()
    assert counterpart["linkedTreeId"] is None
    assert counterpart["linkedMemberId"] is None


def test_deleting_bridge_person_unlinks_counterpart(client, db):
    """Deleting one half of a bridge person turns the surviving counterpart
    back into an ordinary member — both link fields cleared, not just the FK
    that points at the deleted row."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")
    created = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "Sub"},
    )
    assert created.status_code == 201
    sub_id = created.json()["tree"]["id"]
    counterpart_id = created.json()["anchor"]["linkedMemberId"]

    # Delete the bridge person in the sub-tree; the origin row must fully unlink.
    res = client.delete(
        f"{API}/trees/{sub_id}/members/{counterpart_id}", headers=auth(user)
    )
    assert res.status_code == 204

    origin = client.get(f"{API}/trees/{main.id}/members/m1", headers=auth(user)).json()
    assert origin["linkedTreeId"] is None
    assert origin["linkedMemberId"] is None


def test_deleting_origin_unlinks_bridge_in_subtree(client, db):
    """Symmetry: deleting the origin bridge person leaves the sub-tree copy an
    ordinary member as well."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1")
    created = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "Sub"},
    )
    assert created.status_code == 201
    sub_id = created.json()["tree"]["id"]
    counterpart_id = created.json()["anchor"]["linkedMemberId"]

    res = client.delete(f"{API}/trees/{main.id}/members/m1", headers=auth(user))
    assert res.status_code == 204

    counterpart = client.get(
        f"{API}/trees/{sub_id}/members/{counterpart_id}", headers=auth(user)
    ).json()
    assert counterpart["linkedTreeId"] is None
    assert counterpart["linkedMemberId"] is None


def test_edit_member_with_unchanged_link_succeeds(client, db):
    """The member form may re-send linkedTreeId unchanged on every save."""
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

    res = client.patch(
        f"{API}/trees/{main.id}/members/m1",
        headers=auth(user),
        json={"firstName": "Joanna", "linkedTreeId": linked_tree_id},
    )
    assert res.status_code == 200
    assert res.json()["firstName"] == "Joanna"
    # The link itself is untouched.
    assert res.json()["linkedTreeId"] == linked_tree_id


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
    assert res.json()["bridgeSync"] == "synced"
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
    anchor = client.get(f"{API}/trees/{main.id}/members/m1", headers=auth(user)).json()
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
    # The editor is told the linked copy did not follow.
    assert res.json()["bridgeSync"] == "skipped_no_access"
    counterpart = client.get(
        f"{API}/trees/{sub_tree_id}/members/{counterpart_id}",
        headers=auth(owner),
    ).json()
    assert counterpart["firstName"] == "Jo"


# --- Link candidates ---------------------------------------------------


def test_link_candidates_returns_only_same_name_unlinked_members(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(client, main, user, "m1", firstName="Jo", lastName="Doe")
    # Same name+gender, different dates -> possible match.
    _create_member(
        client,
        other,
        user,
        "same-name",
        firstName="Jo",
        lastName="Doe",
        dateOfBirth="1950-01-01",
    )
    # Different name entirely -> excluded.
    _create_member(client, other, user, "diff-name", firstName="Someone", lastName="Else")
    # Same name but already linked elsewhere -> excluded.
    third = make_tree(db, user, "Third")
    _create_member(client, other, user, "already-linked", firstName="Jo", lastName="Doe")
    client.post(
        f"{API}/trees/{other.id}/members/already-linked/link",
        headers=auth(user),
        json={"linkedTreeId": third.id, "mode": "create"},
    )

    res = client.get(
        f"{API}/trees/{main.id}/members/m1/link-candidates",
        headers=auth(user),
        params={"target_tree_id": other.id},
    )
    assert res.status_code == 200
    candidates = res.json()["candidates"]
    ids = {c["member_b"]["id"] for c in candidates}
    assert ids == {"same-name"}
    pair = candidates[0]
    assert pair["match"] == "possible"
    assert "date_of_birth" in pair["conflicts"]
    assert pair["member_a"]["id"] == "m1"


def test_link_candidates_exact_match_has_no_date_conflict(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(
        client,
        main,
        user,
        "m1",
        firstName="Jo",
        lastName="Doe",
        dateOfBirth="1950-01-01",
    )
    _create_member(
        client,
        other,
        user,
        "twin",
        firstName="Jo",
        lastName="Doe",
        dateOfBirth="1950-01-01",
    )

    res = client.get(
        f"{API}/trees/{main.id}/members/m1/link-candidates",
        headers=auth(user),
        params={"target_tree_id": other.id},
    )
    assert res.status_code == 200
    candidates = res.json()["candidates"]
    assert len(candidates) == 1
    assert candidates[0]["match"] == "exact"
    assert candidates[0]["conflicts"] == []


def test_link_candidates_excludes_self(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    _create_member(client, main, user, "m1", firstName="Jo", lastName="Doe")

    res = client.get(
        f"{API}/trees/{main.id}/members/m1/link-candidates",
        headers=auth(user),
        params={"target_tree_id": main.id},
    )
    # Linking a member to its own tree is rejected up front.
    assert res.status_code == 400


def test_link_candidates_requires_write_access_to_target(client, db):
    from tests.conftest import share

    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    main = make_tree(db, owner, "Main")
    other = make_tree(db, owner, "Other")
    _create_member(client, main, owner, "m1")
    share(db, main, viewer, "editor")
    share(db, other, viewer, "viewer")

    res = client.get(
        f"{API}/trees/{main.id}/members/m1/link-candidates",
        headers=auth(viewer),
        params={"target_tree_id": other.id},
    )
    assert res.status_code == 403


# --- Link field-choice reconciliation -----------------------------------


def test_link_existing_without_choices_unions_empties_into_both_rows(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(
        client,
        main,
        user,
        "m1",
        firstName="Jo",
        lastName="Doe",
        birthplace="Vienna",
    )
    _create_member(
        client,
        other,
        user,
        "counterpart",
        firstName="Jo",
        lastName="Doe",
        cemetery="Ohlsdorf",
    )

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={
            "linkedTreeId": other.id,
            "mode": "existing",
            "counterpartMemberId": "counterpart",
        },
    )
    assert res.status_code == 201

    anchor = client.get(f"{API}/trees/{main.id}/members/m1", headers=auth(user)).json()
    counterpart = client.get(
        f"{API}/trees/{other.id}/members/counterpart", headers=auth(user)
    ).json()
    # Neither side had a cemetery/birthplace conflict (one side was empty), so
    # the union fills in the missing value on both rows.
    assert anchor["birthplace"] == "Vienna"
    assert counterpart["birthplace"] == "Vienna"
    assert anchor["cemetery"] == "Ohlsdorf"
    assert counterpart["cemetery"] == "Ohlsdorf"


def test_link_existing_field_choices_reconcile_both_rows(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(
        client,
        main,
        user,
        "m1",
        firstName="Jo",
        lastName="Doe",
        birthplace="Vienna",
        hometown="Salzburg",
        cemetery="A",
    )
    _create_member(
        client,
        other,
        user,
        "counterpart",
        firstName="Jo",
        lastName="Doe",
        birthplace="Graz",
        hometown="Linz",
        cemetery="B",
    )

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={
            "linkedTreeId": other.id,
            "mode": "existing",
            "counterpartMemberId": "counterpart",
            "fieldChoices": {
                "birthplace": "a",
                "hometown": "b",
                "cemetery": "combine",
            },
        },
    )
    assert res.status_code == 201

    anchor = client.get(f"{API}/trees/{main.id}/members/m1", headers=auth(user)).json()
    counterpart = client.get(
        f"{API}/trees/{other.id}/members/counterpart", headers=auth(user)
    ).json()
    assert anchor["birthplace"] == "Vienna"
    assert counterpart["birthplace"] == "Vienna"
    assert anchor["hometown"] == "Linz"
    assert counterpart["hometown"] == "Linz"
    # "combine" doesn't apply to a non-text field like cemetery -> falls back
    # to A's value on both rows.
    assert anchor["cemetery"] == "A"
    assert counterpart["cemetery"] == "A"


def test_link_existing_field_choices_combine_text_field(client, db):
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(
        client,
        main,
        user,
        "m1",
        firstName="Jo",
        lastName="Doe",
        additionalData="Loved gardening.",
    )
    _create_member(
        client,
        other,
        user,
        "counterpart",
        firstName="Jo",
        lastName="Doe",
        additionalData="Played the violin.",
    )

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={
            "linkedTreeId": other.id,
            "mode": "existing",
            "counterpartMemberId": "counterpart",
            "fieldChoices": {"additionalData": "combine"},
        },
    )
    assert res.status_code == 201

    anchor = client.get(f"{API}/trees/{main.id}/members/m1", headers=auth(user)).json()
    counterpart = client.get(
        f"{API}/trees/{other.id}/members/counterpart", headers=auth(user)
    ).json()
    combined = anchor["additionalData"]
    assert "Loved gardening." in combined
    assert "Played the violin." in combined
    assert counterpart["additionalData"] == combined


def test_link_mode_create_ignores_field_choices(client, db):
    """field_choices has no counterpart data to reconcile against under
    mode="create" (the counterpart is a fresh clone of the source member)."""
    user = make_user(db, "alice")
    main = make_tree(db, user, "Main")
    other = make_tree(db, user, "Other")
    _create_member(
        client,
        main,
        user,
        "m1",
        firstName="Jo",
        lastName="Doe",
        birthplace="Vienna",
    )

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/link",
        headers=auth(user),
        json={
            "linkedTreeId": other.id,
            "mode": "create",
            "fieldChoices": {"birthplace": "b"},
        },
    )
    assert res.status_code == 201
    members = client.get(f"{API}/trees/{other.id}/members", headers=auth(user)).json()
    assert members[0]["birthplace"] == "Vienna"
