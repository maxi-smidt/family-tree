"""Sections, section membership, and per-section layout (#982)."""

import pytest
from sqlalchemy.exc import IntegrityError

import app.services.sections as sections_service
from app.models import Member, Relation, Section, SectionMember, SectionPosition
from app.services.members.member_merge import merge_members_in_place
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _add_relation(db, tree, from_id, to_id, relation_type="parent"):
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id=from_id,
            to_member_id=to_id,
            relation_type=relation_type,
        )
    )
    db.commit()


def _make_family(db, tree):
    """root's parent p1; p1's other child sib; root's partner; root+partner's
    shared child.

    "direct_family" from root => {p1, sib}; "partnership" from root =>
    {partner, child}. Boundary of the direct_family branch is {partner, child}
    (the people it connects out to but doesn't include).
    """
    for m in ("root", "p1", "sib", "partner", "child"):
        add_member(db, tree, m)
    _add_relation(db, tree, "root", "p1", "parent")
    _add_relation(db, tree, "sib", "p1", "parent")
    _add_relation(db, tree, "root", "partner", "partner")
    _add_relation(db, tree, "child", "root", "parent")
    _add_relation(db, tree, "child", "partner", "parent")


def _create(client, user, tree, **kw):
    payload = {"name": "Section"}
    payload.update(kw)
    url = f"{API}/workspaces/{tree.id}/sections"
    return client.post(url, headers=auth(user), json=payload)


def test_list_empty_on_fresh_workspace(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    res = client.get(f"{API}/workspaces/{tree.id}/sections", headers=auth(user))
    assert res.status_code == 200
    assert res.json() == []


def test_create_empty_section(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    res = _create(client, user, tree, name="Unresolved research")
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "Unresolved research"
    assert body["member_count"] == 0
    assert body["position"] == 0


def test_create_section_seeds_membership_from_traversal(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    _make_family(db, tree)

    res = _create(
        client,
        user,
        tree,
        name="Direct family",
        root_member_id="root",
        direction="direct_family",
    )
    assert res.status_code == 201
    assert res.json()["member_count"] == 3  # root, p1, sib

    members = client.get(
        f"{API}/workspaces/{tree.id}/sections", headers=auth(user)
    ).json()
    assert members[0]["member_count"] == 3


def test_create_section_partnership_direction(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    _make_family(db, tree)

    res = _create(
        client,
        user,
        tree,
        name="Partnership",
        root_member_id="root",
        direction="partnership",
    )
    assert res.status_code == 201
    assert res.json()["member_count"] == 3  # root, partner, child


def test_duplicate_name_conflicts_case_insensitively(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    assert _create(client, user, tree, name="Vienna branch").status_code == 201
    res = _create(client, user, tree, name="vienna BRANCH")
    assert res.status_code == 409


def test_preview_reports_primary_boundary_and_overlaps(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    _make_family(db, tree)
    existing = _create(
        client, user, tree, name="Existing", root_member_id="partner"
    ).json()

    res = client.get(
        f"{API}/workspaces/{tree.id}/sections/preview",
        headers=auth(user),
        params={"root_member_id": "root", "direction": "direct_family"},
    )
    assert res.status_code == 200
    body = res.json()
    assert set(body["primary_member_ids"]) == {"root", "p1", "sib"}
    assert set(body["boundary_member_ids"]) == {"partner", "child"}
    assert body["overlaps"] == [
        {"section_id": existing["id"], "section_name": "Existing", "member_count": 1}
    ]


def test_update_rename_and_reorder(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    section = _create(client, user, tree, name="Old name").json()

    res = client.patch(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}",
        headers=auth(user),
        json={"name": "New name", "position": 5},
    )
    assert res.status_code == 200
    assert res.json()["name"] == "New name"
    assert res.json()["position"] == 5


def test_delete_section_leaves_members_and_relations_untouched(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    _make_family(db, tree)
    section = _create(
        client,
        user,
        tree,
        name="Gone soon",
        root_member_id="root",
        direction="direct_family",
    ).json()

    res = client.delete(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}", headers=auth(user)
    )
    assert res.status_code == 204
    list_res = client.get(f"{API}/workspaces/{tree.id}/sections", headers=auth(user))
    assert list_res.json() == []
    assert db.query(Member).filter(Member.workspace_id == tree.id).count() == 5
    assert db.query(Relation).filter(Relation.workspace_id == tree.id).count() == 5


def test_set_members_replaces_and_ignores_foreign_members(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    other_tree = make_tree(db, user, "Other")
    add_member(db, tree, "m1")
    add_member(db, tree, "m2")
    add_member(db, other_tree, "foreign")
    section = _create(client, user, tree, name="Section").json()

    res = client.put(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}/members",
        headers=auth(user),
        json={"member_ids": ["m1", "foreign"]},
    )
    assert res.status_code == 204
    body = client.get(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}", headers=auth(user)
    ).json()
    assert body["member_count"] == 1

    res = client.put(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}/members",
        headers=auth(user),
        json={"member_ids": ["m2"]},
    )
    assert res.status_code == 204
    body = client.get(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}", headers=auth(user)
    ).json()
    assert body["member_count"] == 1


def test_positions_upsert(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    add_member(db, tree, "outsider")
    section = _create(client, user, tree, name="Section").json()
    client.put(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}/members",
        headers=auth(user),
        json={"member_ids": ["m1"]},
    )

    res = client.patch(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}/members/positions",
        headers=auth(user),
        json=[
            {"member_id": "m1", "position_x": 1.5, "position_y": 2.5},
            {"member_id": "outsider", "position_x": 0, "position_y": 0},
        ],
    )
    assert res.status_code == 204
    rows = db.query(SectionPosition).filter(
        SectionPosition.section_id == section["id"]
    ).all()
    assert {(r.member_id, r.position_x, r.position_y) for r in rows} == {
        ("m1", 1.5, 2.5)
    }

    res = client.patch(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}/members/positions",
        headers=auth(user),
        json=[{"member_id": "m1", "position_x": 9, "position_y": 9}],
    )
    assert res.status_code == 204
    db.expire_all()
    rows = db.query(SectionPosition).filter(
        SectionPosition.section_id == section["id"]
    ).all()
    assert {(r.member_id, r.position_x, r.position_y) for r in rows} == {("m1", 9, 9)}


def test_removing_member_prunes_their_position(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section = _create(client, user, tree, name="Section").json()
    client.put(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}/members",
        headers=auth(user),
        json={"member_ids": ["m1"]},
    )
    client.patch(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}/members/positions",
        headers=auth(user),
        json=[{"member_id": "m1", "position_x": 1, "position_y": 1}],
    )

    client.put(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}/members",
        headers=auth(user),
        json={"member_ids": []},
    )
    remaining = db.query(SectionPosition).filter(
        SectionPosition.section_id == section["id"]
    ).all()
    assert remaining == []


def test_suggestions_from_parent_membership(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "p1")
    add_member(db, tree, "newkid")
    _add_relation(db, tree, "newkid", "p1", "parent")
    section = _create(client, user, tree, name="Family A").json()
    client.put(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}/members",
        headers=auth(user),
        json={"member_ids": ["p1"]},
    )

    res = client.get(
        f"{API}/workspaces/{tree.id}/sections/suggestions",
        headers=auth(user),
        params={"member_id": "newkid"},
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["section"]["id"] == section["id"]
    assert body[0]["matched_via_member_ids"] == ["p1"]

    # Already a member of the section: no longer suggested.
    client.put(
        f"{API}/workspaces/{tree.id}/sections/{section['id']}/members",
        headers=auth(user),
        json={"member_ids": ["p1", "newkid"]},
    )
    res = client.get(
        f"{API}/workspaces/{tree.id}/sections/suggestions",
        headers=auth(user),
        params={"member_id": "newkid"},
    )
    assert res.json() == []


def test_viewer_can_read_but_not_write(client, db):
    owner = make_user(db, "owner")
    viewer = make_user(db, "viewer")
    tree = make_tree(db, owner)
    share(db, tree, viewer, role="viewer")

    list_res = client.get(f"{API}/workspaces/{tree.id}/sections", headers=auth(viewer))
    assert list_res.status_code == 200
    res = _create(client, viewer, tree, name="Nope")
    assert res.status_code == 403


def test_unknown_section_id_is_404(client, db):
    user = make_user(db)
    tree = make_tree(db, user)

    missing_url = f"{API}/workspaces/{tree.id}/sections/missing"
    assert client.get(missing_url, headers=auth(user)).status_code == 404
    patch_res = client.patch(missing_url, headers=auth(user), json={"name": "New"})
    assert patch_res.status_code == 404
    assert client.delete(missing_url, headers=auth(user)).status_code == 404


def test_preview_unknown_root_member_is_404(client, db):
    user = make_user(db)
    tree = make_tree(db, user)

    res = client.get(
        f"{API}/workspaces/{tree.id}/sections/preview",
        headers=auth(user),
        params={"root_member_id": "missing", "direction": "direct_family"},
    )
    assert res.status_code == 404


def test_db_rejects_case_insensitive_duplicate_name_bypassing_the_service(db):
    """The service pre-check is a fast-path UX nicety; the actual guarantee is
    the DB constraint on name_normalized (see models/section.py)."""
    user = make_user(db)
    tree = make_tree(db, user)
    db.add(Section(workspace_id=tree.id, name="Vienna branch", position=0))
    db.commit()

    db.add(Section(workspace_id=tree.id, name="vienna BRANCH", position=1))
    with pytest.raises(IntegrityError):
        db.commit()


def test_race_on_create_surfaces_as_409_not_500(client, db, monkeypatch):
    """Simulates two requests racing past the service-layer name pre-check by
    forcing the DB insert itself to collide."""
    user = make_user(db)
    tree = make_tree(db, user)
    _create(client, user, tree, name="Vienna branch")

    monkeypatch.setattr(
        sections_service, "_validate_name", lambda db, tree, name, **kw: name
    )
    res = _create(client, user, tree, name="Vienna branch")
    assert res.status_code == 409


def test_merge_repoints_section_membership_and_position_onto_keep(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep")
    remove = add_member(db, tree, "remove")
    section = Section(id="s1", workspace_id=tree.id, name="Section", position=0)
    db.add(section)
    db.add(SectionMember(section_id="s1", member_id="remove"))
    db.add(
        SectionPosition(section_id="s1", member_id="remove", position_x=3, position_y=4)
    )
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    members = db.query(SectionMember).filter(SectionMember.section_id == "s1").all()
    assert [m.member_id for m in members] == ["keep"]
    positions = db.query(SectionPosition).filter(SectionPosition.section_id == "s1").all()
    assert len(positions) == 1
    assert positions[0].member_id == "keep"
    assert (positions[0].position_x, positions[0].position_y) == (3, 4)
