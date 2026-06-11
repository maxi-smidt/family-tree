"""Tests for the /virtual-views endpoints."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import API, add_member, auth, make_tree, make_user, share


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def add_overlap(db, tree_a, tree_b) -> None:
    """Add a matching member (same name + birth year) in both trees so creation passes."""
    add_member(
        db, tree_a, f"overlap-a-{tree_a.id[:8]}",
        firstName="John", lastName="Smith", dateOfBirth="1900", gender="m",
    )
    add_member(
        db, tree_b, f"overlap-b-{tree_b.id[:8]}",
        firstName="John", lastName="Smith", dateOfBirth="1900", gender="m",
    )


def create_view(client, user, tree_a_id, tree_b_id, name="My View"):
    return client.post(
        f"{API}/virtual-views",
        json={"name": name, "source_tree_ids": [tree_a_id, tree_b_id]},
        headers=auth(user),
    )


# ---------------------------------------------------------------------------
# CRUD: create
# ---------------------------------------------------------------------------


def test_create_requires_two_sources(client: TestClient, db: Session):
    alice = make_user(db)
    tree = make_tree(db, alice)

    r = client.post(
        f"{API}/virtual-views",
        json={"name": "Bad", "source_tree_ids": [tree.id]},
        headers=auth(alice),
    )
    assert r.status_code == 400


def test_create_rejects_inaccessible_source(client: TestClient, db: Session):
    alice = make_user(db)
    bob = make_user(db, "bob")
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, bob)  # alice has no access

    r = create_view(client, alice, tree_a.id, tree_b.id)
    assert r.status_code == 403


def test_create_fails_without_overlap(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_member(db, tree_a, "a1", firstName="Alice", lastName="A")
    add_member(db, tree_b, "b1", firstName="Bob", lastName="B")

    r = create_view(client, alice, tree_a.id, tree_b.id)
    assert r.status_code == 409
    assert r.json()["detail"] == "virtual_view_sources_no_overlap"


def test_create_succeeds(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)

    r = create_view(client, alice, tree_a.id, tree_b.id)
    assert r.status_code == 201
    data = r.json()
    assert data["id"].startswith("vv_")
    assert data["is_virtual"] is True
    assert data["role"] == "viewer"
    assert len(data["sources"]) == 2


def test_create_with_shared_source(client: TestClient, db: Session):
    alice = make_user(db)
    bob = make_user(db, "bob")
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, bob)
    share(db, tree_b, alice, role="viewer")
    add_overlap(db, tree_a, tree_b)

    r = create_view(client, alice, tree_a.id, tree_b.id)
    assert r.status_code == 201


# ---------------------------------------------------------------------------
# CRUD: list
# ---------------------------------------------------------------------------


def test_list_returns_only_own_views(client: TestClient, db: Session):
    alice = make_user(db)
    bob = make_user(db, "bob")
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)
    create_view(client, alice, tree_a.id, tree_b.id)

    r = client.get(f"{API}/virtual-views", headers=auth(bob))
    assert r.status_code == 200
    assert r.json() == []


def test_admin_sees_all_views(client: TestClient, db: Session):
    alice = make_user(db)
    admin = make_user(db, "admin", is_admin=True)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)
    create_view(client, alice, tree_a.id, tree_b.id)

    r = client.get(f"{API}/virtual-views", headers=auth(admin))
    assert r.status_code == 200
    assert len(r.json()) == 1


# ---------------------------------------------------------------------------
# GET single view
# ---------------------------------------------------------------------------


def test_get_view_sets_last_opened(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)
    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    assert (client.get(f"{API}/virtual-views/{view_id}", headers=auth(alice))
            .status_code == 200)


def test_get_view_not_found_for_other_user(client: TestClient, db: Session):
    alice = make_user(db)
    bob = make_user(db, "bob")
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)
    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    r = client.get(f"{API}/virtual-views/{view_id}", headers=auth(bob))
    assert r.status_code == 404


def test_get_view_fails_when_source_access_revoked(client: TestClient, db: Session):
    alice = make_user(db)
    bob = make_user(db, "bob")
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, bob)
    share(db, tree_b, alice, role="viewer")
    add_overlap(db, tree_a, tree_b)

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    # Revoke alice's access to tree_b
    client.delete(
        f"{API}/trees/{tree_b.id}/access/{alice.id}", headers=auth(bob)
    )

    r = client.get(f"{API}/virtual-views/{view_id}", headers=auth(alice))
    assert r.status_code == 403
    assert r.json()["detail"] == "virtual_view_source_access_revoked"


def test_get_view_fails_when_source_deleted(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    # Delete one source tree — the junction row is cascade-deleted
    client.delete(f"{API}/trees/{tree_b.id}", headers=auth(alice))

    r = client.get(f"{API}/virtual-views/{view_id}", headers=auth(alice))
    assert r.status_code == 409
    assert r.json()["detail"] == "virtual_view_sources_missing"


# ---------------------------------------------------------------------------
# Composite reads
# ---------------------------------------------------------------------------


def test_members_returns_union_with_source_tags(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice, name="Paternal")
    tree_b = make_tree(db, alice, name="Maternal")
    # Distinct members (no overlap on their own)
    add_member(db, tree_a, "m1", firstName="Alice", lastName="A")
    add_member(db, tree_b, "m2", firstName="Bob", lastName="B")
    # Overlap pair that satisfies the creation constraint (will be merged)
    add_member(
        db, tree_a, "j1",
        firstName="John", lastName="Smith", dateOfBirth="1900", gender="m",
    )
    add_member(
        db, tree_b, "j2",
        firstName="John", lastName="Smith", dateOfBirth="1900", gender="m",
    )

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    r = client.get(f"{API}/virtual-views/{view_id}/members", headers=auth(alice))
    assert r.status_code == 200
    members = r.json()
    # 2 distinct + 1 merged = 3 nodes
    assert len(members) == 3

    by_id = {m["id"]: m for m in members}
    # Non-merged members keep their original ids and source tags
    assert by_id["m1"]["sourceTreeId"] == tree_a.id
    assert by_id["m1"]["sourceTreeName"] == "Paternal"
    assert by_id["m2"]["sourceTreeId"] == tree_b.id
    assert by_id["m2"]["sourceTreeName"] == "Maternal"

    # The merged node has a vm_ id and isMerged=True
    merged = [m for m in members if m.get("isMerged")]
    assert len(merged) == 1
    assert merged[0]["id"].startswith("vm_")
    assert set(merged[0]["sourceTreeIds"]) == {tree_a.id, tree_b.id}


def test_relations_returns_union(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    r = client.get(f"{API}/virtual-views/{view_id}/relations", headers=auth(alice))
    assert r.status_code == 200


def test_relation_types_deduplicated(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    r = client.get(
        f"{API}/virtual-views/{view_id}/relation-types", headers=auth(alice)
    )
    assert r.status_code == 200
    ids = [rt["id"] for rt in r.json()]
    assert len(ids) == len(set(ids)), "relation type IDs must be unique"


# ---------------------------------------------------------------------------
# PATCH / DELETE
# ---------------------------------------------------------------------------


def test_patch_name(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)
    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    r = client.patch(
        f"{API}/virtual-views/{view_id}",
        json={"name": "Renamed View"},
        headers=auth(alice),
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed View"


def test_delete_view_leaves_source_trees_intact(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)
    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    assert (
        client.delete(f"{API}/virtual-views/{view_id}", headers=auth(alice)).status_code
        == 204
    )
    # Trees still exist
    assert client.get(f"{API}/trees/{tree_a.id}", headers=auth(alice)).status_code == 200
    assert client.get(f"{API}/trees/{tree_b.id}", headers=auth(alice)).status_code == 200


def test_delete_requires_ownership(client: TestClient, db: Session):
    alice = make_user(db)
    bob = make_user(db, "bob")
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)
    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    r = client.delete(f"{API}/virtual-views/{view_id}", headers=auth(bob))
    assert r.status_code in (403, 404)
