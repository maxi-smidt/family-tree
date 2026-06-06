from tests.conftest import API, auth, make_tree, make_user, share


def _member_payload(member_id="m1", **kw):
    base = {"id": member_id, "firstName": "Jo", "lastName": "Doe", "gender": "f"}
    base.update(kw)
    return base


def test_viewer_can_read_but_not_write(client, db):
    owner = make_user(db, "owner")
    viewer = make_user(db, "viewer")
    tree = make_tree(db, owner)
    share(db, tree, viewer, "viewer")

    assert (
        client.get(f"{API}/trees/{tree.id}/members", headers=auth(viewer)).status_code
        == 200
    )
    blocked = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(viewer),
        json=_member_payload(),
    )
    assert blocked.status_code == 403


def test_editor_can_write(client, db):
    owner = make_user(db, "owner")
    editor = make_user(db, "ed")
    tree = make_tree(db, owner)
    share(db, tree, editor, "editor")

    res = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=auth(editor),
        json=_member_payload(),
    )
    assert res.status_code == 201


def test_stranger_has_no_access(client, db):
    owner = make_user(db, "owner")
    stranger = make_user(db, "mallory")
    tree = make_tree(db, owner)

    assert (
        client.get(f"{API}/trees/{tree.id}/members", headers=auth(stranger)).status_code
        == 403
    )


def test_admin_has_full_access_to_any_tree(client, db):
    owner = make_user(db, "owner")
    admin = make_user(db, "root", is_admin=True)
    tree = make_tree(db, owner)

    assert (
        client.post(
            f"{API}/trees/{tree.id}/members",
            headers=auth(admin),
            json=_member_payload(),
        ).status_code
        == 201
    )


def test_requests_require_authentication(client, db):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)
    assert client.get(f"{API}/trees/{tree.id}/members").status_code == 401
