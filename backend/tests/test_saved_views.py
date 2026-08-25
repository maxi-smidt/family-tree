"""Saved views: config CRUD, workspace scoping, and lifecycle hardening (#986)."""

from app.models import Section, SectionMember, WorkspaceSectionGrant
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _section(db, tree, name="Section") -> Section:
    section = Section(workspace_id=tree.id, name=name)
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


def _create(client, user, tree, **kw):
    payload = {"name": "My view"}
    payload.update(kw)
    return client.post(
        f"{API}/workspaces/{tree.id}/saved-views", headers=auth(user), json=payload
    )


def test_create_minimal_saved_view(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    res = _create(client, user, tree)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "My view"
    assert body["focus_member_id"] is None
    assert body["section_ids"] == []
    assert body["ancestor_depth"] == 3
    assert body["descendant_depth"] == 3
    assert body["include_partners"] is True
    assert body["version"] == 1


def test_create_requires_name(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    res = _create(client, user, tree, name="   ")
    assert res.status_code == 422


def test_create_with_focus_member_and_sections(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    section = _section(db, tree)

    res = _create(
        client,
        user,
        tree,
        focus_member_id="root",
        section_ids=[section.id],
        ancestor_depth=2,
        descendant_depth=5,
        include_partners=False,
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["focus_member_id"] == "root"
    assert body["section_ids"] == [section.id]
    assert body["ancestor_depth"] == 2
    assert body["descendant_depth"] == 5
    assert body["include_partners"] is False


def test_create_rejects_focus_member_from_another_workspace(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    other_tree = make_tree(db, user, name="Other")
    add_member(db, other_tree, "foreign")

    res = _create(client, user, tree, focus_member_id="foreign")
    assert res.status_code == 400


def test_create_rejects_section_from_another_workspace(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    other_tree = make_tree(db, user, name="Other")
    foreign_section = _section(db, other_tree)

    res = _create(client, user, tree, section_ids=[foreign_section.id])
    assert res.status_code == 400


def test_list_only_shows_owners_views(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    share(db, tree, bob, role="editor")

    _create(client, alice, tree, name="Alice's view")
    _create(client, bob, tree, name="Bob's view")

    alice_views = client.get(
        f"{API}/workspaces/{tree.id}/saved-views", headers=auth(alice)
    ).json()
    bob_views = client.get(
        f"{API}/workspaces/{tree.id}/saved-views", headers=auth(bob)
    ).json()
    assert [v["name"] for v in alice_views] == ["Alice's view"]
    assert [v["name"] for v in bob_views] == ["Bob's view"]


def test_admin_can_list_and_open_any_view(client, db):
    alice = make_user(db, "alice")
    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, alice)
    view_id = _create(client, alice, tree).json()["id"]

    admin_views = client.get(
        f"{API}/workspaces/{tree.id}/saved-views", headers=auth(admin)
    ).json()
    assert [v["id"] for v in admin_views] == [view_id]

    res = client.get(
        f"{API}/workspaces/{tree.id}/saved-views/{view_id}", headers=auth(admin)
    )
    assert res.status_code == 200


def test_non_owner_gets_404(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    share(db, tree, bob, role="editor")
    view_id = _create(client, alice, tree).json()["id"]

    res = client.get(
        f"{API}/workspaces/{tree.id}/saved-views/{view_id}", headers=auth(bob)
    )
    assert res.status_code == 404


def test_update_replaces_config_and_bumps_version(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    view = _create(client, user, tree).json()

    res = client.patch(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}",
        headers=auth(user),
        json={
            "name": "Renamed",
            "focus_member_id": "root",
            "ancestor_depth": 1,
            "expected_version": view["version"],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == "Renamed"
    assert body["focus_member_id"] == "root"
    assert body["ancestor_depth"] == 1
    assert body["version"] == view["version"] + 1


def test_update_with_stale_version_conflicts(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    view = _create(client, user, tree).json()

    ok = client.patch(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}",
        headers=auth(user),
        json={"name": "First edit", "expected_version": view["version"]},
    )
    assert ok.status_code == 200

    stale = client.patch(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}",
        headers=auth(user),
        json={"name": "Second edit", "expected_version": view["version"]},
    )
    assert stale.status_code == 409


def test_clear_focus_member(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    view = _create(client, user, tree, focus_member_id="root").json()

    res = client.patch(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}",
        headers=auth(user),
        json={"clear_focus_member": True, "expected_version": view["version"]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["focus_member_id"] is None


def test_delete_saved_view(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    view = _create(client, user, tree).json()

    res = client.delete(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}", headers=auth(user)
    )
    assert res.status_code == 204
    assert (
        client.get(
            f"{API}/workspaces/{tree.id}/saved-views/{view['id']}", headers=auth(user)
        ).status_code
        == 404
    )


def test_positions_upsert_and_state(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    view = _create(client, user, tree).json()

    res = client.patch(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}/positions",
        headers=auth(user),
        json=[{"node_id": "root", "position_x": 10.0, "position_y": 20.0}],
    )
    assert res.status_code == 204

    state_res = client.patch(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}/state",
        headers=auth(user),
        json={"camera_x": 5.0, "camera_y": 6.0, "camera_zoom": 1.5},
    )
    assert state_res.status_code == 200, state_res.text
    body = state_res.json()
    assert body["camera_x"] == 5.0
    assert body["camera_zoom"] == 1.5

    get_res = client.get(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}/state", headers=auth(user)
    )
    assert get_res.json()["camera_x"] == 5.0


# --- Lifecycle hardening -----------------------------------------------------


def test_deleting_focus_member_degrades_view_instead_of_blocking_delete(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    view = _create(client, user, tree, focus_member_id="root").json()

    res = client.delete(f"{API}/workspaces/{tree.id}/members/root", headers=auth(user))
    assert res.status_code == 204

    reloaded = client.get(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}", headers=auth(user)
    ).json()
    assert reloaded["focus_member_id"] is None


def test_deleting_section_narrows_view_instead_of_blocking_delete(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    section = _section(db, tree)
    other_section = _section(db, tree, "Other")
    view = _create(
        client, user, tree, section_ids=[section.id, other_section.id]
    ).json()

    res = client.delete(
        f"{API}/workspaces/{tree.id}/sections/{section.id}", headers=auth(user)
    )
    assert res.status_code == 204

    reloaded = client.get(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}", headers=auth(user)
    ).json()
    assert reloaded["section_ids"] == [other_section.id]


def test_deleting_workspace_cascades_saved_views(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    view_id = _create(client, user, tree, focus_member_id="root").json()["id"]
    client.patch(
        f"{API}/workspaces/{tree.id}/saved-views/{view_id}/positions",
        headers=auth(user),
        json=[{"node_id": "root", "position_x": 1.0, "position_y": 2.0}],
    )

    res = client.delete(f"{API}/workspaces/{tree.id}", headers=auth(user))
    assert res.status_code == 204


def test_merging_focus_member_repoints_saved_view_onto_survivor(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "keep")
    add_member(db, tree, "remove")
    view = _create(client, user, tree, focus_member_id="remove").json()
    client.patch(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}/positions",
        headers=auth(user),
        json=[{"node_id": "remove", "position_x": 1.0, "position_y": 2.0}],
    )

    res = client.post(
        f"{API}/workspaces/{tree.id}/members/merge",
        headers=auth(user),
        json={"keep_id": "keep", "remove_id": "remove", "fields": {}},
    )
    assert res.status_code == 200, res.text

    reloaded = client.get(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}", headers=auth(user)
    ).json()
    assert reloaded["focus_member_id"] == "keep"


def test_scoped_collaborator_can_own_a_view_within_their_scope(client, db):
    """View ownership and access remain correct when the creator is a scoped
    collaborator rather than the workspace owner (#986)."""
    owner = make_user(db, "owner")
    collaborator = make_user(db, "collaborator")
    tree = make_tree(db, owner)
    granted = _section(db, tree, "Granted")
    other = _section(db, tree, "Other")
    add_member(db, tree, "in_scope")
    add_member(db, tree, "out_of_scope")
    db.add(SectionMember(section_id=granted.id, member_id="in_scope"))
    db.add(SectionMember(section_id=other.id, member_id="out_of_scope"))
    db.add(
        WorkspaceSectionGrant(
            workspace_id=tree.id,
            section_id=granted.id,
            user_id=collaborator.id,
            role="editor",
        )
    )
    db.commit()

    ok = _create(
        client, collaborator, tree, focus_member_id="in_scope", section_ids=[granted.id]
    )
    assert ok.status_code == 201, ok.text

    denied_member = _create(client, collaborator, tree, focus_member_id="out_of_scope")
    assert denied_member.status_code == 403

    denied_section = _create(client, collaborator, tree, section_ids=[other.id])
    assert denied_section.status_code == 403


def test_view_degrades_when_owners_section_grant_is_revoked(client, db):
    owner = make_user(db, "owner")
    collaborator = make_user(db, "collaborator")
    admin = make_user(db, "admin", is_admin=True)
    tree = make_tree(db, owner)
    granted = _section(db, tree, "Granted")
    add_member(db, tree, "in_scope")
    db.add(SectionMember(section_id=granted.id, member_id="in_scope"))
    grant = WorkspaceSectionGrant(
        workspace_id=tree.id,
        section_id=granted.id,
        user_id=collaborator.id,
        role="editor",
    )
    db.add(grant)
    db.commit()

    view = _create(
        client,
        collaborator,
        tree,
        focus_member_id="in_scope",
        section_ids=[granted.id],
    ).json()

    # Revoke the collaborator's only grant.
    db.delete(db.get(WorkspaceSectionGrant, grant.id))
    db.commit()

    # An admin can still open the (now-degraded) view; nothing is destroyed.
    reloaded = client.get(
        f"{API}/workspaces/{tree.id}/saved-views/{view['id']}", headers=auth(admin)
    ).json()
    assert reloaded["focus_member_id"] is None
    assert reloaded["section_ids"] == []
