"""Tests for the /virtual-views endpoints."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Relation,
)
from tests.conftest import API, add_member, auth, make_tree, make_user, share

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def add_relation(db, tree, from_id, to_id, rel_type="parent") -> None:
    db.add(
        Relation(
            tree_id=tree.id,
            from_member_id=from_id,
            to_member_id=to_id,
            relation_type=rel_type,
        )
    )
    db.commit()


def add_overlap(db, tree_a, tree_b) -> None:
    """Add a matching member (same name + birth year) in both trees so creation passes."""
    add_member(
        db, tree_a, f"overlap-a-{tree_a.id[:8]}",
        first_name="John", last_name="Smith", date_of_birth="1900", gender="m",
    )
    add_member(
        db, tree_b, f"overlap-b-{tree_b.id[:8]}",
        first_name="John", last_name="Smith", date_of_birth="1900", gender="m",
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
    add_member(db, tree_a, "a1", first_name="Alice", last_name="A")
    add_member(db, tree_b, "b1", first_name="Bob", last_name="B")

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
    add_member(db, tree_a, "m1", first_name="Alice", last_name="A")
    add_member(db, tree_b, "m2", first_name="Bob", last_name="B")
    # Overlap pair that satisfies the creation constraint (will be merged)
    add_member(
        db, tree_a, "j1",
        first_name="John", last_name="Smith", date_of_birth="1900", gender="m",
    )
    add_member(
        db, tree_b, "j2",
        first_name="John", last_name="Smith", date_of_birth="1900", gender="m",
    )

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    r = client.get(f"{API}/virtual-views/{view_id}/members", headers=auth(alice))
    assert r.status_code == 200
    members = r.json()
    # 2 distinct + 1 merged = 3 nodes
    assert len(members) == 3

    by_id = {m["id"]: m for m in members}
    # Non-merged members keep their original ids and source tags
    assert by_id["m1"]["source_tree_id"] == tree_a.id
    assert by_id["m1"]["source_tree_name"] == "Paternal"
    assert by_id["m2"]["source_tree_id"] == tree_b.id
    assert by_id["m2"]["source_tree_name"] == "Maternal"

    # The merged node has a vm_ id and is_merged=True
    merged = [m for m in members if m.get("is_merged")]
    assert len(merged) == 1
    assert merged[0]["id"].startswith("vm_")
    assert set(merged[0]["source_tree_ids"]) == {tree_a.id, tree_b.id}


def test_relations_returns_union(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    r = client.get(f"{API}/virtual-views/{view_id}/relations", headers=auth(alice))
    assert r.status_code == 200


def test_merged_node_keeps_parents_from_secondary_tree(
    client: TestClient, db: Session
):
    """The merged node bridges the trees: when only the secondary tree records
    its parents, those parent relations must survive (remapped to the vm_ id)."""
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    # Homer exists in both trees (merged, primary = tree_a member).
    add_member(
        db, tree_a, "homer-a",
        first_name="Homer", last_name="Simpson", date_of_birth="1956", gender="m",
    )
    add_member(
        db, tree_b, "homer-b",
        first_name="Homer", last_name="Simpson", date_of_birth="1956", gender="m",
    )
    # His parents only exist in tree_b.
    add_member(db, tree_b, "abe", first_name="Abraham", last_name="Simpson", gender="m")
    add_member(db, tree_b, "mona", first_name="Mona", last_name="Simpson", gender="f")
    add_relation(db, tree_b, "homer-b", "abe")
    add_relation(db, tree_b, "homer-b", "mona")

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    members = client.get(
        f"{API}/virtual-views/{view_id}/members", headers=auth(alice)
    ).json()
    merged_id = next(m["id"] for m in members if m["is_merged"])

    rels = client.get(
        f"{API}/virtual-views/{view_id}/relations", headers=auth(alice)
    ).json()
    parent_targets = {
        r["to_member_id"]
        for r in rels
        if r["relation_type"] == "parent" and r["from_member_id"] == merged_id
    }
    assert parent_targets == {"abe", "mona"}


def test_merged_node_prefers_primary_parents(client: TestClient, db: Session):
    """When both source members record parents, only the primary's are kept so
    the merged node never accumulates more than two parents."""
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_member(
        db, tree_a, "homer-a",
        first_name="Homer", last_name="Simpson", date_of_birth="1956", gender="m",
    )
    add_member(
        db, tree_b, "homer-b",
        first_name="Homer", last_name="Simpson", date_of_birth="1956", gender="m",
    )
    # Distinctly-named parents in each tree so they do not merge themselves.
    add_member(db, tree_a, "abe-a", first_name="Abe", last_name="Simpson", gender="m")
    add_member(
        db, tree_b, "abraham-b",
        first_name="Abraham", last_name="Simpson", gender="m",
    )
    add_relation(db, tree_a, "homer-a", "abe-a")
    add_relation(db, tree_b, "homer-b", "abraham-b")

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    members = client.get(
        f"{API}/virtual-views/{view_id}/members", headers=auth(alice)
    ).json()
    merged_id = next(m["id"] for m in members if m["is_merged"])

    rels = client.get(
        f"{API}/virtual-views/{view_id}/relations", headers=auth(alice)
    ).json()
    parent_targets = {
        r["to_member_id"]
        for r in rels
        if r["relation_type"] == "parent" and r["from_member_id"] == merged_id
    }
    assert parent_targets == {"abe-a"}


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


def test_patch_sources_recomputes_matches_against_new_trees(
    client: TestClient, db: Session
):
    """Updating a view's sources must recompute matches with the NEW source
    list — not the stale, previously-loaded one."""
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    tree_c = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)
    # The same person also exists in tree_c.
    add_member(
        db, tree_c, "overlap-c",
        first_name="John", last_name="Smith", date_of_birth="1900", gender="m",
    )
    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    r = client.patch(
        f"{API}/virtual-views/{view_id}",
        json={"source_tree_ids": [tree_a.id, tree_b.id, tree_c.id]},
        headers=auth(alice),
    )
    assert r.status_code == 200

    members = client.get(
        f"{API}/virtual-views/{view_id}/members", headers=auth(alice)
    ).json()
    merged = [m for m in members if m["is_merged"]]
    assert len(merged) == 1
    assert set(merged[0]["source_tree_ids"]) == {tree_a.id, tree_b.id, tree_c.id}


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


# ---------------------------------------------------------------------------
# Nested virtual views (recursive composition)
# ---------------------------------------------------------------------------


def create_view_n(client, user, source_ids, name="Nested"):
    return client.post(
        f"{API}/virtual-views",
        json={"name": name, "source_tree_ids": source_ids},
        headers=auth(user),
    )


def _john(db, *trees) -> None:
    for i, t in enumerate(trees):
        add_member(
            db, t, f"john-{t.id[:8]}-{i}",
            first_name="John", last_name="Smith", date_of_birth="1900", gender="m",
        )


def test_virtual_view_can_source_another_virtual_view(
    client: TestClient, db: Session
):
    """A virtual view may be a source of another; matching runs over the
    flattened underlying trees, so {C, vv(A, B)} behaves like {A, B, C}."""
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    tree_c = make_tree(db, alice)
    _john(db, tree_a, tree_b, tree_c)

    inner = create_view_n(client, alice, [tree_a.id, tree_b.id], "Inner").json()
    outer = create_view_n(client, alice, [inner["id"], tree_c.id], "Outer")
    assert outer.status_code == 201
    data = outer.json()

    virtual_sources = [s for s in data["sources"] if s.get("is_virtual")]
    assert len(virtual_sources) == 1
    assert virtual_sources[0]["kind"] == "view"
    assert virtual_sources[0]["tree_id"] == inner["id"]

    members = client.get(
        f"{API}/virtual-views/{data['id']}/members", headers=auth(alice)
    ).json()
    merged = [m for m in members if m["is_merged"]]
    assert len(merged) == 1
    assert set(merged[0]["source_tree_ids"]) == {tree_a.id, tree_b.id, tree_c.id}


def test_cycle_rejected_on_update(client: TestClient, db: Session):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    tree_c = make_tree(db, alice)
    _john(db, tree_a, tree_b, tree_c)

    inner = create_view_n(client, alice, [tree_a.id, tree_b.id]).json()
    outer = create_view_n(client, alice, [inner["id"], tree_c.id]).json()

    # Making inner source outer would close a loop (outer already sources inner).
    r = client.patch(
        f"{API}/virtual-views/{inner['id']}",
        json={"source_tree_ids": [outer["id"], tree_a.id]},
        headers=auth(alice),
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "virtual_view_source_cycle"


def test_nested_source_deleted_makes_parent_missing(
    client: TestClient, db: Session
):
    """Deleting a nested source view cascades the junction row, dropping the
    parent below its 2-source minimum."""
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    tree_c = make_tree(db, alice)
    _john(db, tree_a, tree_b, tree_c)

    inner = create_view_n(client, alice, [tree_a.id, tree_b.id]).json()
    outer = create_view_n(client, alice, [inner["id"], tree_c.id]).json()

    assert (
        client.delete(
            f"{API}/virtual-views/{inner['id']}", headers=auth(alice)
        ).status_code
        == 204
    )
    r = client.get(f"{API}/virtual-views/{outer['id']}", headers=auth(alice))
    assert r.status_code == 409
    assert r.json()["detail"] == "virtual_view_sources_missing"


def test_nested_source_access_revoked(client: TestClient, db: Session):
    """Access is checked recursively: losing a tree buried under a nested view
    breaks the outer view."""
    alice = make_user(db)
    bob = make_user(db, "bob")
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, bob)
    share(db, tree_b, alice, role="viewer")
    tree_c = make_tree(db, alice)
    _john(db, tree_a, tree_b, tree_c)

    inner = create_view_n(client, alice, [tree_a.id, tree_b.id]).json()
    outer = create_view_n(client, alice, [inner["id"], tree_c.id]).json()

    client.delete(
        f"{API}/trees/{tree_b.id}/access/{alice.id}", headers=auth(bob)
    )

    r = client.get(f"{API}/virtual-views/{outer['id']}", headers=auth(alice))
    assert r.status_code == 403
    assert r.json()["detail"] == "virtual_view_source_access_revoked"


# ---------------------------------------------------------------------------
# Composite feature parity
# ---------------------------------------------------------------------------


def _add_homer(db, tree_a, tree_b):
    """Homer exists in both trees (merged) — returns the two member ids."""
    add_member(
        db, tree_a, "homer-a",
        first_name="Homer", last_name="Simpson", date_of_birth="1956", gender="m",
    )
    add_member(
        db, tree_b, "homer-b",
        first_name="Homer", last_name="Simpson", date_of_birth="1956", gender="m",
    )


def test_composite_gallery_and_events_remap_member_links(
    client: TestClient, db: Session
):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    _add_homer(db, tree_a, tree_b)
    # Image in tree_a links homer-a; event in tree_b links homer-b.
    db.add(GalleryImage(id="img1", tree_id=tree_a.id, title="Pic"))
    db.add(GalleryMemberLink(gallery_image_id="img1", member_id="homer-a"))
    db.add(
        Event(
            id="ev1", tree_id=tree_b.id, event_type="birth",
            date="1956", created_at="2020-01-01",
        )
    )
    db.add(EventMemberLink(event_id="ev1", member_id="homer-b"))
    db.commit()

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]
    members = client.get(
        f"{API}/virtual-views/{view_id}/members", headers=auth(alice)
    ).json()
    merged_id = next(m["id"] for m in members if m["is_merged"])

    imgs = client.get(
        f"{API}/virtual-views/{view_id}/gallery/images", headers=auth(alice)
    ).json()
    assert {i["id"] for i in imgs} == {"img1"}
    glinks = client.get(
        f"{API}/virtual-views/{view_id}/gallery/links", headers=auth(alice)
    ).json()
    assert glinks == [{"gallery_image_id": "img1", "member_id": merged_id}]

    evs = client.get(
        f"{API}/virtual-views/{view_id}/events", headers=auth(alice)
    ).json()
    assert {e["id"] for e in evs} == {"ev1"}
    elinks = client.get(
        f"{API}/virtual-views/{view_id}/events/links", headers=auth(alice)
    ).json()
    assert elinks == [{"event_id": "ev1", "member_id": merged_id}]


def test_composite_statistics_dedupes_merged_people(
    client: TestClient, db: Session
):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    _add_homer(db, tree_a, tree_b)  # merged → counts once
    add_member(
        db, tree_a, "marge",
        first_name="Marge", last_name="Simpson", date_of_birth="1958", gender="f",
    )
    add_member(
        db, tree_b, "bart",
        first_name="Bart", last_name="Simpson", date_of_birth="1980", gender="m",
    )

    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]
    stats = client.get(
        f"{API}/virtual-views/{view_id}/statistics", headers=auth(alice)
    ).json()
    # Homer, Marge, Bart — Homer is not double-counted.
    assert stats["total_members"] == 3


def test_composite_geocode_and_quality_reachable(
    client: TestClient, db: Session
):
    alice = make_user(db)
    tree_a = make_tree(db, alice)
    tree_b = make_tree(db, alice)
    add_overlap(db, tree_a, tree_b)
    view_id = create_view(client, alice, tree_a.id, tree_b.id).json()["id"]

    geo = client.post(
        f"{API}/virtual-views/{view_id}/geocode",
        json={"locations": []},
        headers=auth(alice),
    )
    assert geo.status_code == 200
    assert geo.json() == []

    quality = client.get(
        f"{API}/virtual-views/{view_id}/quality-report", headers=auth(alice)
    )
    assert quality.status_code == 200
    assert quality.json()["tree_id"] == view_id
