from app.models import Event, EventMemberLink, Relation
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _create_member(client, tree, user, member_id, **kw):
    payload = {"id": member_id, "firstName": "Jo", "lastName": "Doe", "gender": "f"}
    payload.update(kw)
    return client.post(
        f"{API}/workspaces/{tree.id}/members", headers=auth(user), json=payload
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
        f"{API}/workspaces/{tree.id}/members/m1",
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

    listed = client.get(f"{API}/workspaces/{tree.id}/members", headers=auth(user)).json()
    assert len(listed) == 1
    assert listed[0]["middleNames"] == "Augusta Byron"

    deleted = client.delete(f"{API}/workspaces/{tree.id}/members/m1", headers=auth(user))
    assert deleted.status_code == 204
    assert (
        client.get(f"{API}/workspaces/{tree.id}/members", headers=auth(user)).json() == []
    )


def test_members_are_scoped_to_their_tree(client, db):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")
    _create_member(client, tree_a, user, "m1")

    # The member exists in tree A but must not be reachable through tree B.
    cross = client.patch(
        f"{API}/workspaces/{tree_b.id}/members/m1",
        headers=auth(user),
        json={"lastName": "X"},
    )
    assert cross.status_code == 404
    assert (
        client.get(f"{API}/workspaces/{tree_b.id}/members", headers=auth(user)).json()
        == []
    )


def test_member_update_atomically_replaces_parent_and_vital_event(client, db):
    user = make_user(db, "atomic")
    tree = make_tree(db, user)
    child = add_member(db, tree, "child", first_name="Before", last_name="Child")
    old_parent = add_member(db, tree, "old-parent", gender="m")
    new_parent = add_member(db, tree, "new-parent", gender="m")
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id=child.id,
            to_member_id=old_parent.id,
            relation_type="parent",
        )
    )
    event = Event(
        id="birth-event",
        workspace_id=tree.id,
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
        f"{API}/workspaces/{tree.id}/members/{child.id}",
        headers=auth(user),
        json=payload,
    )
    assert response.status_code == 200

    db.expire_all()
    assert db.get(type(child), child.id).last_name == "Updated"
    relations = (
        db.query(Relation).filter_by(workspace_id=tree.id, relation_type="parent").all()
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
            f"{API}/workspaces/{tree.id}/members/{child.id}",
            headers=auth(user),
            json=payload,
        ).status_code
        == 200
    )
    assert (
        db.query(Relation).filter_by(workspace_id=tree.id, relation_type="parent").count()
        == 1
    )
    assert (
        db.query(Event).filter_by(workspace_id=tree.id, event_type="birth").count() == 1
    )


def test_member_update_creates_birth_event_seeded_with_birthplace(client, db):
    user = make_user(db, "seed-birth")
    tree = make_tree(db, user)
    member = add_member(db, tree, "m1", first_name="Ada", last_name="Lovelace")

    response = client.patch(
        f"{API}/workspaces/{tree.id}/members/{member.id}",
        headers=auth(user),
        json={"dateOfBirth": "1815-12-10", "birthplace": "London"},
    )
    assert response.status_code == 200

    event = db.query(Event).filter_by(workspace_id=tree.id, event_type="birth").one()
    assert event.date == "1815-12-10"
    assert event.location == "London"


def test_member_update_creates_death_event_seeded_with_cemetery(client, db):
    user = make_user(db, "seed-death")
    tree = make_tree(db, user)
    member = add_member(db, tree, "m1", first_name="Ada", last_name="Lovelace")

    response = client.patch(
        f"{API}/workspaces/{tree.id}/members/{member.id}",
        headers=auth(user),
        json={"dateOfDeath": "1852-11-27", "cemetery": "Hucknall Torkard"},
    )
    assert response.status_code == 200

    event = db.query(Event).filter_by(workspace_id=tree.id, event_type="death").one()
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
        workspace_id=tree.id,
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
        f"{API}/workspaces/{tree.id}/members/{member.id}",
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
        workspace_id=tree.id,
        event_type="birth",
        date="1815",
        location="Vienna",
        created_at="2024-01-01T00:00:00Z",
    )
    db.add(event)
    db.add(EventMemberLink(event_id=event.id, member_id=member.id))
    db.commit()

    response = client.patch(
        f"{API}/workspaces/{tree.id}/members/{member.id}",
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
            workspace_id=tree.id,
            from_member_id=child.id,
            to_member_id=old_parent.id,
            relation_type="parent",
        )
    )
    db.commit()

    response = client.patch(
        f"{API}/workspaces/{tree.id}/members/{child.id}",
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
        .filter_by(
            workspace_id=tree.id, from_member_id=child.id, to_member_id=old_parent.id
        )
        .count()
        == 1
    )
    assert (
        db.query(Event).filter_by(workspace_id=tree.id, event_type="birth").count() == 0
    )


def test_member_update_succeeds_when_events_are_restricted(client, db):
    from app.models.workspace import WorkspaceMembership

    owner = make_user(db, "events-owner")
    editor = make_user(db, "events-restricted-editor")
    tree = make_tree(db, owner)
    child = add_member(db, tree, "child", last_name="Before")
    share(db, tree, editor, role="editor")
    membership = db.get(WorkspaceMembership, (tree.id, editor.id))
    membership.restrictions = ["events"]
    db.commit()

    response = client.patch(
        f"{API}/workspaces/{tree.id}/members/{child.id}",
        headers=auth(editor),
        json={"lastName": "After", "dateOfBirth": "1901"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["lastName"] == "After"

    db.expire_all()
    assert db.get(type(child), child.id).last_name == "After"
    assert db.query(Event).filter_by(workspace_id=tree.id).count() == 0


def test_bulk_position_update(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    _create_member(client, tree, user, "m1")
    _create_member(client, tree, user, "m2")

    res = client.patch(
        f"{API}/workspaces/{tree.id}/members/positions",
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
            f"{API}/workspaces/{tree.id}/members", headers=auth(user)
        ).json()
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

    listed = client.get(f"{API}/workspaces/{tree.id}/members", headers=auth(user)).json()
    assert listed[0]["firstName"] == "Ada"
    assert listed[0]["lastName"] == "Lovelace"


def test_update_member_trims_whitespace(client, db):
    user = make_user(db, "trimmer2")
    tree = make_tree(db, user)
    _create_member(client, tree, user, "m1")

    updated = client.patch(
        f"{API}/workspaces/{tree.id}/members/m1",
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

    fetched = client.get(f"{API}/workspaces/{tree.id}/members", headers=auth(user)).json()
    assert fetched[0]["lastName"] == "Lovelace"


def test_update_member_whitespace_only_field_trims_to_empty_string(client, db):
    user = make_user(db, "trimmer3")
    tree = make_tree(db, user)
    _create_member(client, tree, user, "m1")

    updated = client.patch(
        f"{API}/workspaces/{tree.id}/members/m1",
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
            f"{API}/workspaces/{tree.id}/relations", headers=auth(user), json=body
        ).status_code
        == 201
    )
    # Adding the same relation again must not create a duplicate.
    client.post(f"{API}/workspaces/{tree.id}/relations", headers=auth(user), json=body)
    relations = client.get(
        f"{API}/workspaces/{tree.id}/relations", headers=auth(user)
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
        f"{API}/workspaces/{tree_b.id}/relations",
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
        f"{API}/workspaces/{tree_a.id}/relations",
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
        f"{API}/workspaces/{tree.id}/relations",
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
        f"{API}/workspaces/{tree.id}/relations",
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
        f"{API}/workspaces/{tree.id}/members?surface=true", headers=auth(user)
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
    res2 = client.get(f"{API}/workspaces/{tree.id}/members", headers=auth(user))
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
        f"{API}/workspaces/{tree.id}/members/m-sort-3",
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
        f"{API}/workspaces/{tree.id}/members?surface=true", headers=auth(user)
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

    res = client.get(f"{API}/workspaces/{tree.id}/members/m1", headers=auth(user))
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == "m1"
    assert data["additionalData"] == "detailed notes"
    assert data["birthplace"] == "Hamburg"
    assert data["cemetery"] == "Ohlsdorf Cemetery"
    assert data["firstName"] == "Jo"
