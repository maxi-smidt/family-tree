"""Instance-wide relation type registry: listing and admin CRUD."""

from sqlalchemy import select

from app.db.init_db import DEFAULT_RELATION_TYPES, _seed_relation_types
from app.models import RelationType
from tests.conftest import API, auth, make_tree, make_user


def test_list_returns_seeded_defaults(client, db):
    user = make_user(db)

    res = client.get(f"{API}/relation-types", headers=auth(user))
    assert res.status_code == 200
    assert {t["id"] for t in res.json()} == set(DEFAULT_RELATION_TYPES)


def test_startup_seed_tops_up_missing_defaults(db):
    db.query(RelationType).delete()
    db.add(RelationType(id="partner"))
    db.add(RelationType(id="child", description="Legacy child type"))
    db.commit()

    _seed_relation_types(db)

    ids = set(db.scalars(select(RelationType.id)).all())
    assert set(DEFAULT_RELATION_TYPES).issubset(ids)
    assert "child" in ids


def test_list_is_public_for_public_tree_relation_metadata(client):
    assert client.get(f"{API}/relation-types").status_code == 200


def test_crud_requires_admin(client, db):
    user = make_user(db)
    res = client.post(
        f"{API}/admin/relation-types", headers=auth(user), json={"id": "godparent"}
    )
    assert res.status_code == 403


def test_admin_create_update_delete(client, db):
    admin = make_user(db, "root", is_admin=True)

    res = client.post(
        f"{API}/admin/relation-types",
        headers=auth(admin),
        json={"id": "godparent", "description": "Godparent"},
    )
    assert res.status_code == 201
    assert res.json() == {
        "id": "godparent",
        "description": "Godparent",
        "label": None,
        "color": None,
        "stroke_width": None,
        "stroke_dasharray": None,
    }

    # Duplicate id is rejected.
    res = client.post(
        f"{API}/admin/relation-types", headers=auth(admin), json={"id": "godparent"}
    )
    assert res.status_code == 409

    res = client.patch(
        f"{API}/admin/relation-types/godparent",
        headers=auth(admin),
        json={"description": "A godparent"},
    )
    assert res.status_code == 200
    assert res.json()["description"] == "A godparent"

    res = client.delete(f"{API}/admin/relation-types/godparent", headers=auth(admin))
    assert res.status_code == 204
    assert db.get(RelationType, "godparent") is None


def test_create_rejects_unsafe_ids(client, db):
    admin = make_user(db, "root", is_admin=True)
    for bad in ["", "Has Spaces", "dot.ted", "-leading", "x" * 51]:
        res = client.post(
            f"{API}/admin/relation-types", headers=auth(admin), json={"id": bad}
        )
        assert res.status_code == 422, bad


def test_parent_cannot_be_deleted(client, db):
    admin = make_user(db, "root", is_admin=True)
    res = client.delete(f"{API}/admin/relation-types/parent", headers=auth(admin))
    assert res.status_code == 409


def test_delete_blocked_while_in_use(client, db):
    admin = make_user(db, "root", is_admin=True)
    tree = make_tree(db, admin)

    for member_id in ("m1", "m2"):
        client.post(
            f"{API}/workspaces/{tree.id}/members",
            headers=auth(admin),
            json={"id": member_id, "firstName": member_id, "lastName": "Test"},
        )
    res = client.post(
        f"{API}/workspaces/{tree.id}/relations",
        headers=auth(admin),
        json={"from_member_id": "m1", "to_member_id": "m2", "relation_type": "married"},
    )
    assert res.status_code in (200, 201)

    res = client.delete(f"{API}/admin/relation-types/married", headers=auth(admin))
    assert res.status_code == 409

    # Removing the relation frees the type up for deletion.
    res = client.delete(
        f"{API}/workspaces/{tree.id}/relations",
        headers=auth(admin),
        params={
            "from_member_id": "m1",
            "to_member_id": "m2",
            "relation_type": "married",
        },
    )
    assert res.status_code == 204
    res = client.delete(f"{API}/admin/relation-types/married", headers=auth(admin))
    assert res.status_code == 204


def test_relation_with_unknown_type_rejected(client, db):
    admin = make_user(db, "root", is_admin=True)
    tree = make_tree(db, admin)
    for member_id in ("m1", "m2"):
        client.post(
            f"{API}/workspaces/{tree.id}/members",
            headers=auth(admin),
            json={"id": member_id, "firstName": member_id, "lastName": "Test"},
        )
    res = client.post(
        f"{API}/workspaces/{tree.id}/relations",
        headers=auth(admin),
        json={"from_member_id": "m1", "to_member_id": "m2", "relation_type": "nope"},
    )
    assert res.status_code == 404
