"""Tests for public read-only tree mode (issue #165)."""

from tests.conftest import API, add_member, auth, make_tree, make_user


def test_owner_can_enable_public_read(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    r = client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    assert r.status_code == 200
    assert r.json()["public_role"] == "viewer"


def test_owner_can_disable_public_read(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    r = client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": None},
        headers=auth(alice),
    )
    assert r.status_code == 200
    assert r.json()["public_role"] is None


def test_invalid_public_role_rejected(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    r = client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "editor"},
        headers=auth(alice),
    )
    assert r.status_code == 400


def test_non_owner_cannot_change_public(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)

    from tests.conftest import share

    share(db, tree, bob, role="editor")

    r = client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(bob),
    )
    assert r.status_code == 403


def test_public_tree_readable_without_auth(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )

    r = client.get(f"{API}/trees/{tree.id}")
    assert r.status_code == 200
    assert r.json()["id"] == tree.id


def test_private_tree_not_readable_without_auth(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    r = client.get(f"{API}/trees/{tree.id}")
    assert r.status_code == 401


def test_public_tree_not_writable_without_auth(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )

    r = client.patch(f"{API}/trees/{tree.id}", json={"name": "Hacked"})
    assert r.status_code == 401


def test_owner_can_set_public_password(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    r = client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": "s3cret12"},
        headers=auth(alice),
    )
    assert r.status_code == 200
    assert r.json()["public_password_protected"] is True


def test_setting_password_on_non_public_tree_rejected(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    r = client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": "s3cret12"},
        headers=auth(alice),
    )
    assert r.status_code == 400


def test_password_protected_public_tree_requires_unlock(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": "s3cret12"},
        headers=auth(alice),
    )

    r = client.get(f"{API}/trees/{tree.id}")
    assert r.status_code == 401
    assert r.json()["detail"] == "public_password_required"


def test_unlock_wrong_password_rejected(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": "s3cret12"},
        headers=auth(alice),
    )

    r = client.post(
        f"{API}/trees/{tree.id}/public/unlock", json={"password": "wrong"}
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid_public_password"


def test_unlock_correct_password_returns_token_and_grants_access(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": "s3cret12"},
        headers=auth(alice),
    )

    r = client.post(
        f"{API}/trees/{tree.id}/public/unlock", json={"password": "s3cret12"}
    )
    assert r.status_code == 200
    token = r.json()["token"]
    assert token

    r = client.get(
        f"{API}/trees/{tree.id}", headers={"X-Public-Tree-Token": token}
    )
    assert r.status_code == 200
    assert r.json()["id"] == tree.id


def test_disabling_public_access_clears_password(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": "s3cret12"},
        headers=auth(alice),
    )
    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": None},
        headers=auth(alice),
    )
    r = client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    assert r.json()["public_password_protected"] is False

    r = client.get(f"{API}/trees/{tree.id}")
    assert r.status_code == 200


def test_clearing_public_password_allows_anonymous_access(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)

    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )
    client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": "s3cret12"},
        headers=auth(alice),
    )
    r = client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": None},
        headers=auth(alice),
    )
    assert r.status_code == 200
    assert r.json()["public_password_protected"] is False

    r = client.get(f"{API}/trees/{tree.id}")
    assert r.status_code == 200


def test_password_rotation_revokes_existing_unlock_token(client, db):
    alice = make_user(db, "rotation-owner")
    tree = make_tree(db, alice)
    headers = auth(alice)
    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=headers,
    )
    client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": "old-password"},
        headers=headers,
    )
    token = client.post(
        f"{API}/trees/{tree.id}/public/unlock",
        json={"password": "old-password"},
    ).json()["token"]

    client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": "new-password"},
        headers=headers,
    )

    denied = client.get(
        f"{API}/trees/{tree.id}", headers={"X-Public-Tree-Token": token}
    )
    assert denied.status_code == 401


def test_public_unlock_is_rate_limited(client, db):
    alice = make_user(db, "rate-limit-owner")
    tree = make_tree(db, alice)
    headers = auth(alice)
    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=headers,
    )
    client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": "correct-password"},
        headers=headers,
    )

    for _ in range(5):
        response = client.post(
            f"{API}/trees/{tree.id}/public/unlock",
            json={"password": "wrong"},
        )
        assert response.status_code == 401

    response = client.post(
        f"{API}/trees/{tree.id}/public/unlock",
        json={"password": "correct-password"},
    )
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) >= 1


def test_public_password_input_is_bounded(client, db):
    alice = make_user(db, "password-bounds-owner")
    tree = make_tree(db, alice)
    headers = auth(alice)
    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=headers,
    )

    too_long = "x" * 73
    assert client.put(
        f"{API}/trees/{tree.id}/public/password",
        json={"password": too_long},
        headers=headers,
    ).status_code == 422
    assert client.post(
        f"{API}/trees/{tree.id}/public/unlock",
        json={"password": too_long},
    ).status_code == 422


def test_public_member_payload_excludes_private_detail(client, db):
    alice = make_user(db, "privacy-owner")
    tree = make_tree(db, alice)
    member = add_member(
        db,
        tree,
        "private-member",
        first_name="Public",
        last_name="Person",
        additional_data="private notes",
        birthplace="Private birthplace",
        hometown="Private hometown",
        cemetery="Private cemetery",
        places_lived='[{"location":"Private address"}]',
        adopted=True,
        linked_tree_id=None,
    )
    client.patch(
        f"{API}/trees/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(alice),
    )

    response = client.get(f"{API}/trees/{tree.id}/members?surface=true")
    assert response.status_code == 200
    payload = response.json()[0]
    assert payload["id"] == member.id
    for private_key in (
        "additionalData",
        "birthplace",
        "hometown",
        "cemetery",
        "placesLived",
        "adopted",
        "linkedTreeId",
        "linkedMemberId",
    ):
        assert private_key not in payload

    assert client.get(
        f"{API}/trees/{tree.id}/members/{member.id}"
    ).status_code == 404
    owner_detail = client.get(
        f"{API}/trees/{tree.id}/members/{member.id}", headers=auth(alice)
    )
    assert owner_detail.status_code == 200
    assert owner_detail.json()["additionalData"] == "private notes"
