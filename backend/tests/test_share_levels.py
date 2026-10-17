"""Per-area access levels on a share (#1101)."""

import pytest

from app.models import WorkspaceMembership
from app.services.workspaces.restrictions import (
    SHARE_AREAS,
    grant_fields_from_levels,
    levels_of,
    normalize_restrictions,
)
from tests.conftest import API, add_member, auth, befriend, make_tree, make_user, share

TREE_ONLY = {area: "hidden" for area in SHARE_AREAS} | {"tree": "view"}
CONTRIBUTOR = {area: "view" for area in SHARE_AREAS} | {
    "tree": "edit",
    "stories": "edit",
    "diseases": "hidden",
}


def test_levels_round_trip_through_grant_fields():
    role, restrictions, read_only = grant_fields_from_levels(CONTRIBUTOR)
    assert role == "editor"
    assert restrictions == ["diseases"]
    assert read_only == ["events", "gallery", "sources", "tasks"]
    assert levels_of(role, restrictions, read_only) == CONTRIBUTOR

    role, restrictions, read_only = grant_fields_from_levels(TREE_ONLY)
    assert (role, read_only) == ("viewer", None)
    assert levels_of(role, restrictions, read_only) == TREE_ONLY


@pytest.mark.parametrize(
    "levels",
    [
        TREE_ONLY | {"tree": "hidden"},
        {"tree": "view"},
        TREE_ONLY | {"photos": "view"},
        TREE_ONLY | {"tree": "admin"},
    ],
)
def test_invalid_levels_are_rejected(levels):
    with pytest.raises(ValueError):
        grant_fields_from_levels(levels)


def test_legacy_toggles_fold_into_areas():
    assert normalize_restrictions(["map", "tree", "biography", "gallery"]) == [
        "events",
        "gallery",
        "stories",
    ]
    assert normalize_restrictions(["tree"]) is None


def test_new_share_hides_health_by_default(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    tree = make_tree(db, owner)

    res = client.post(
        f"{API}/workspaces/{tree.id}/access",
        headers=auth(owner),
        json={"username": "bob", "role": "editor"},
    )
    bob_row = next(r for r in res.json() if r["username"] == "bob")
    assert bob_row["restrictions"] == ["diseases"]


def _set_levels(client, owner, tree, user, levels, **params):
    return client.put(
        f"{API}/workspaces/{tree.id}/access/{user.id}/levels",
        headers=auth(owner),
        params=params,
        json={"levels": levels},
    )


def test_owner_sets_levels_and_listing_reports_them(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, bob, "viewer")

    res = _set_levels(client, owner, tree, bob, CONTRIBUTOR)
    assert res.status_code == 200, res.text
    row = next(r for r in res.json() if r["username"] == "bob")
    assert row["role"] == "editor"
    assert row["restrictions"] == ["diseases"]
    assert row["read_only"] == ["events", "gallery", "sources", "tasks"]

    summary = client.get(f"{API}/workspaces/{tree.id}", headers=auth(bob)).json()
    assert summary["read_only"] == ["events", "gallery", "sources", "tasks"]


def test_only_the_owner_sets_levels(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, bob, "editor")

    assert _set_levels(client, bob, tree, bob, CONTRIBUTOR).status_code == 403


def test_tree_only_share_sees_people_but_no_events(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")
    share(db, tree, bob, "editor")
    _set_levels(client, owner, tree, bob, TREE_ONLY)

    members = client.get(f"{API}/workspaces/{tree.id}/members", headers=auth(bob))
    assert [m["id"] for m in members.json()] == ["m1"]
    events = client.get(f"{API}/workspaces/{tree.id}/events", headers=auth(bob))
    assert events.status_code == 404
    edit = client.patch(
        f"{API}/workspaces/{tree.id}/members/m1",
        headers=auth(bob),
        json={"firstName": "Changed"},
    )
    assert edit.status_code == 403


def test_contributor_edits_the_tree_but_only_views_events(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")
    share(db, tree, bob, "editor")
    _set_levels(client, owner, tree, bob, CONTRIBUTOR)

    edit = client.patch(
        f"{API}/workspaces/{tree.id}/members/m1",
        headers=auth(bob),
        json={"firstName": "Changed"},
    )
    assert edit.status_code == 200, edit.text
    events = client.get(f"{API}/workspaces/{tree.id}/events", headers=auth(bob))
    assert events.status_code == 200
    create = client.post(
        f"{API}/workspaces/{tree.id}/events",
        headers=auth(bob),
        json={
            "id": "e1",
            "event_type": "marriage",
            "date": "2000-01-01",
            "created_at": "2000-01-01T00:00:00Z",
        },
    )
    assert create.status_code == 403


def test_tree_viewer_with_editable_events_cannot_edit_people(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")
    share(db, tree, bob, "viewer")
    levels = {area: "view" for area in SHARE_AREAS} | {"events": "edit"}
    _set_levels(client, owner, tree, bob, levels)

    create = client.post(
        f"{API}/workspaces/{tree.id}/events",
        headers=auth(bob),
        json={
            "id": "e1",
            "event_type": "marriage",
            "date": "2000-01-01",
            "created_at": "2000-01-01T00:00:00Z",
        },
    )
    assert create.status_code == 201, create.text
    member = client.post(
        f"{API}/workspaces/{tree.id}/members",
        headers=auth(bob),
        json={"id": "m2", "firstName": "New"},
    )
    assert member.status_code == 403


def test_levels_on_a_section_grant_leave_other_grants_alone(client, db):
    from app.models import Section, WorkspaceSectionGrant

    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, bob, "editor")
    section = Section(workspace_id=tree.id, name="Branch")
    db.add(section)
    db.commit()
    db.add(
        WorkspaceSectionGrant(
            workspace_id=tree.id, section_id=section.id, user_id=bob.id, role="editor"
        )
    )
    db.commit()

    res = _set_levels(client, owner, tree, bob, TREE_ONLY, section_id=section.id)
    assert res.status_code == 200, res.text
    rows = {r["section_id"]: r for r in res.json() if r["username"] == "bob"}
    assert rows[section.id]["role"] == "viewer"
    assert rows[None]["role"] == "editor"
    membership = db.get(WorkspaceMembership, (tree.id, bob.id))
    db.refresh(membership)
    assert membership.restrictions is None


def test_portrait_changes_need_photo_edit_but_resaving_it_does_not(client, db):
    owner = make_user(db, "owner")
    bob = make_user(db, "bob")
    tree = make_tree(db, owner)
    url = f"/api/media/{tree.id}/portrait.webp"
    add_member(db, tree, "m1", first_name="Ada", image_data=url)
    share(db, tree, bob, "editor")
    _set_levels(client, owner, tree, bob, CONTRIBUTOR)
    base = f"{API}/workspaces/{tree.id}/members/m1"

    same = client.patch(
        base, headers=auth(bob), json={"firstName": "Ada B", "imageData": url}
    )
    assert same.status_code == 200, same.text
    changed = client.patch(base, headers=auth(bob), json={"imageData": None})
    assert changed.status_code == 403
