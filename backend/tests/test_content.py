from tests.conftest import API, add_member, auth, make_tree, make_user


def _setup(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="A")
    add_member(db, tree, "m2", first_name="B")
    return user, tree


def test_create_event_with_member_ids_links_in_one_request(client, db):
    user, tree = _setup(client, db)
    res = client.post(
        f"{API}/trees/{tree.id}/events",
        headers=auth(user),
        json={
            "id": "e1",
            "event_type": "marriage",
            "date": "2000-01-01",
            "created_at": "2000-01-01T00:00:00Z",
            "member_ids": ["m1", "m2"],
        },
    )
    assert res.status_code == 201

    links = client.get(f"{API}/trees/{tree.id}/events/links", headers=auth(user)).json()
    assert {link["member_id"] for link in links} == {"m1", "m2"}


def test_set_event_links_replaces_existing(client, db):
    user, tree = _setup(client, db)
    client.post(
        f"{API}/trees/{tree.id}/events",
        headers=auth(user),
        json={
            "id": "e1",
            "event_type": "birth",
            "date": "2000",
            "created_at": "2000",
            "member_ids": ["m1"],
        },
    )
    res = client.put(
        f"{API}/trees/{tree.id}/events/e1/links",
        headers=auth(user),
        json={"member_ids": ["m2"]},
    )
    assert res.status_code == 204

    links = client.get(f"{API}/trees/{tree.id}/events/links", headers=auth(user)).json()
    assert {link["member_id"] for link in links} == {"m2"}


def test_links_ignore_members_from_other_trees(client, db):
    user, tree = _setup(client, db)
    other_tree = make_tree(db, user, "Other")
    add_member(db, other_tree, "foreign")

    client.post(
        f"{API}/trees/{tree.id}/stories",
        headers=auth(user),
        json={
            "id": "s1",
            "title": "Tale",
            "content": "...",
            "created_at": "2000",
            "updated_at": "2000",
            "member_ids": ["m1", "foreign"],
        },
    )
    links = client.get(
        f"{API}/trees/{tree.id}/stories/links", headers=auth(user)
    ).json()
    # "foreign" belongs to another tree and must be dropped.
    assert {link["member_id"] for link in links} == {"m1"}


def test_create_story_with_member_ids(client, db):
    user, tree = _setup(client, db)
    res = client.post(
        f"{API}/trees/{tree.id}/stories",
        headers=auth(user),
        json={
            "id": "s1",
            "title": "Tale",
            "content": "Once upon a time",
            "created_at": "2000",
            "updated_at": "2000",
            "member_ids": ["m1", "m2"],
        },
    )
    assert res.status_code == 201
    links = client.get(
        f"{API}/trees/{tree.id}/stories/links", headers=auth(user)
    ).json()
    assert {link["member_id"] for link in links} == {"m1", "m2"}
