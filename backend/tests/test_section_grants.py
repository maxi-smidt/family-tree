"""The normalized v2 grant model: section-scoped access, public links, and
invitation scope (#993)."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Section, WorkspaceInvitation, WorkspaceSectionGrant
from app.services.workspaces.grants import (
    best_role,
    effective_grant,
    permitted_section_ids,
    restricts_domain,
)
from app.services.workspaces.public_links import (
    active_public_grants,
    create_section_public_link,
    revoke_section_public_link,
    set_section_public_link_password,
)
from tests.conftest import API, auth, make_tree, make_user


def _section(db, tree, name="Section") -> Section:
    section = Section(workspace_id=tree.id, name=name)
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


def _grant(
    db, tree, section, user, role="editor", restrictions=None
) -> WorkspaceSectionGrant:
    grant = WorkspaceSectionGrant(
        workspace_id=tree.id,
        section_id=section.id,
        user_id=user.id,
        role=role,
        restrictions=restrictions,
    )
    db.add(grant)
    db.commit()
    db.refresh(grant)
    return grant


# ---------------------------------------------------------------------------
# Resolver: independent role/restrictions per section, never synthesized
# ---------------------------------------------------------------------------


def test_consolidation_fixture_keeps_per_section_role_and_restrictions(db):
    """A user migrated from two same-owner v1 trees ends up editor+unrestricted
    in one section and viewer+restricted in the other — the exact scenario
    #993 exists to preserve without widening or narrowing access."""
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section_a = _section(db, tree, "Tree A")
    section_b = _section(db, tree, "Tree B")
    _grant(db, tree, section_a, bob, role="editor")
    _grant(db, tree, section_b, bob, role="viewer", restrictions=["gallery"])

    grant_a = effective_grant(db, tree.id, bob.id, section_id=section_a.id)
    grant_b = effective_grant(db, tree.id, bob.id, section_id=section_b.id)

    assert grant_a.role == "editor"
    assert grant_a.restrictions == ()
    assert grant_b.role == "viewer"
    assert grant_b.restrictions == ("gallery",)


def test_resolver_never_synthesizes_role_and_restrictions_across_grants(db):
    """The editor role from an unrestricted workspace-wide grant must never
    combine with a *different* scoped grant's restrictions, or vice versa."""
    from tests.conftest import share

    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    share(db, tree, bob, role="viewer")  # workspace-wide, unrestricted
    _grant(db, tree, section, bob, role="editor", restrictions=["gallery", "events"])

    # Inside the section: the section grant wins (higher role), whole and
    # unmodified — restricted exactly as recorded, not "unrestricted because
    # the workspace-wide grant has no restrictions".
    grant = effective_grant(db, tree.id, bob.id, section_id=section.id)
    assert grant.role == "editor"
    assert set(grant.restrictions) == {"gallery", "events"}

    # Outside any section: only the workspace-wide grant applies.
    workspace_wide = effective_grant(db, tree.id, bob.id, section_id=None)
    assert workspace_wide.role == "viewer"
    assert workspace_wide.restrictions == ()


def test_unlinked_content_in_a_section_excludes_a_collaborator_scoped_elsewhere(
    db,
):
    """A collaborator scoped only to section B must never have section A in
    their permitted set — the resolver-level guarantee behind "unlinked
    content from one constituent tree never leaks to another's collaborator"."""
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section_a = _section(db, tree, "A")
    section_b = _section(db, tree, "B")
    _grant(db, tree, section_b, bob, role="viewer")

    permitted = permitted_section_ids(db, tree.id, bob.id)
    assert permitted == {section_b.id}
    assert section_a.id not in permitted


# ---------------------------------------------------------------------------
# Coarse gates: a purely section-scoped user still has a way in
# ---------------------------------------------------------------------------


def test_section_scoped_only_user_can_open_the_workspace(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    _grant(db, tree, section, bob, role="viewer")

    res = client.get(f"{API}/workspaces/{tree.id}", headers=auth(bob))
    assert res.status_code == 200
    assert res.json()["role"] == "viewer"
    assert best_role(db, tree.id, bob.id) == "viewer"


def test_section_scoped_only_user_appears_in_their_workspace_list(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    _grant(db, tree, section, bob, role="viewer")

    res = client.get(f"{API}/workspaces", headers=auth(bob))
    assert res.status_code == 200
    assert any(t["id"] == tree.id for t in res.json())


def test_section_scoped_editor_cannot_write_outside_permitted_sections(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    in_scope = _section(db, tree, "In scope")
    out_of_scope = _section(db, tree, "Out of scope")
    _grant(db, tree, in_scope, bob, role="editor")

    ok = client.post(
        f"{API}/workspaces/{tree.id}/members?origin_section_id={in_scope.id}",
        json={"id": "m-in-scope", "firstName": "In"},
        headers=auth(bob),
    )
    assert ok.status_code == 201, ok.text

    denied = client.post(
        f"{API}/workspaces/{tree.id}/members?origin_section_id={out_of_scope.id}",
        json={"id": "m-out-of-scope", "firstName": "Out"},
        headers=auth(bob),
    )
    assert denied.status_code == 400, denied.text


def test_domain_restriction_only_bites_when_every_grant_restricts_it(db):
    from tests.conftest import share

    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    share(db, tree, bob, role="viewer")  # unrestricted, workspace-wide
    _grant(db, tree, section, bob, role="viewer", restrictions=["gallery"])

    assert restricts_domain(db, tree.id, bob.id, "gallery") is False

    # Once every one of bob's grants restricts the domain, the coarse gate bites.
    from app.models import WorkspaceMembership

    membership = db.get(WorkspaceMembership, (tree.id, bob.id))
    membership.restrictions = ["gallery"]
    db.commit()
    assert restricts_domain(db, tree.id, bob.id, "gallery") is True


# ---------------------------------------------------------------------------
# Database constraints
# ---------------------------------------------------------------------------


def test_db_rejects_duplicate_grant_for_the_same_scope(db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    _grant(db, tree, section, bob, role="viewer")

    db.add(
        WorkspaceSectionGrant(
            workspace_id=tree.id, section_id=section.id, user_id=bob.id, role="editor"
        )
    )
    try:
        db.commit()
        raise AssertionError("expected IntegrityError")
    except IntegrityError:
        db.rollback()


def test_db_rejects_grant_referencing_a_section_in_another_workspace(db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    other_tree = make_tree(db, alice, name="Other")
    foreign_section = _section(db, other_tree)

    db.add(
        WorkspaceSectionGrant(
            workspace_id=tree.id,
            section_id=foreign_section.id,
            user_id=bob.id,
            role="viewer",
        )
    )
    try:
        db.commit()
        raise AssertionError("expected IntegrityError")
    except IntegrityError:
        db.rollback()


def test_db_rejects_invitation_section_in_another_workspace(db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)
    other_tree = make_tree(db, alice, name="Other")
    foreign_section = _section(db, other_tree)

    db.add(
        WorkspaceInvitation(
            workspace_id=tree.id,
            token="tok-cross-workspace",
            role="editor",
            section_id=foreign_section.id,
            created_by=alice.id,
        )
    )
    try:
        db.commit()
        raise AssertionError("expected IntegrityError")
    except IntegrityError:
        db.rollback()


# ---------------------------------------------------------------------------
# Section deletion is restricted until grants/invitations/public links go
# ---------------------------------------------------------------------------


def test_section_with_a_grant_cannot_be_deleted(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    _grant(db, tree, section, bob, role="viewer")

    res = client.delete(
        f"{API}/workspaces/{tree.id}/sections/{section.id}", headers=auth(alice)
    )
    assert res.status_code == 409

    deps = client.get(
        f"{API}/workspaces/{tree.id}/sections/{section.id}/dependents",
        headers=auth(alice),
    )
    assert deps.json()["grant_count"] == 1


def test_section_deletable_once_its_grant_is_revoked(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    grant = _grant(db, tree, section, bob, role="viewer")

    db.delete(grant)
    db.commit()

    res = client.delete(
        f"{API}/workspaces/{tree.id}/sections/{section.id}", headers=auth(alice)
    )
    assert res.status_code == 204


def test_section_with_a_pending_invitation_cannot_be_deleted(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)
    section = _section(db, tree)

    res = client.post(
        f"{API}/workspaces/{tree.id}/invitations",
        headers=auth(alice),
        json={"role": "editor", "section_id": section.id},
    )
    assert res.status_code == 201, res.text

    deleted = client.delete(
        f"{API}/workspaces/{tree.id}/sections/{section.id}", headers=auth(alice)
    )
    assert deleted.status_code == 409


# ---------------------------------------------------------------------------
# Invitations carry section scope through acceptance
# ---------------------------------------------------------------------------


def test_accepting_a_section_scoped_invite_creates_a_section_grant(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)

    inv = client.post(
        f"{API}/workspaces/{tree.id}/invitations",
        headers=auth(alice),
        json={"role": "editor", "section_id": section.id},
    ).json()
    assert inv["section_id"] == section.id

    res = client.post(f"{API}/invites/{inv['token']}/accept", headers=auth(bob))
    assert res.status_code == 200

    grant = db.scalar(
        select(WorkspaceSectionGrant).where(
            WorkspaceSectionGrant.workspace_id == tree.id,
            WorkspaceSectionGrant.user_id == bob.id,
        )
    )
    assert grant is not None
    assert grant.section_id == section.id
    assert grant.role == "editor"

    from app.models import WorkspaceMembership

    assert db.get(WorkspaceMembership, (tree.id, bob.id)) is None


def test_accepting_a_section_invite_never_merges_into_a_different_scoped_grant(
    client, db
):
    """Bob already holds a workspace-wide viewer grant. Accepting a
    section-scoped editor invite must create a *new*, independent
    section grant rather than upgrading the unrelated workspace-wide one."""
    from tests.conftest import share

    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    share(db, tree, bob, role="viewer")

    inv = client.post(
        f"{API}/workspaces/{tree.id}/invitations",
        headers=auth(alice),
        json={"role": "editor", "section_id": section.id},
    ).json()
    client.post(f"{API}/invites/{inv['token']}/accept", headers=auth(bob))

    from app.models import WorkspaceMembership

    membership = db.get(WorkspaceMembership, (tree.id, bob.id))
    assert membership.role == "viewer"  # untouched

    grant = db.scalar(
        select(WorkspaceSectionGrant).where(
            WorkspaceSectionGrant.workspace_id == tree.id,
            WorkspaceSectionGrant.user_id == bob.id,
            WorkspaceSectionGrant.section_id == section.id,
        )
    )
    assert grant is not None
    assert grant.role == "editor"


# ---------------------------------------------------------------------------
# list_tree_access surfaces section grants as their own rows
# ---------------------------------------------------------------------------


def test_access_listing_includes_section_grants_as_separate_rows(client, db):
    from tests.conftest import share

    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    share(db, tree, bob, role="viewer")
    _grant(db, tree, section, bob, role="editor", restrictions=["gallery"])

    res = client.get(f"{API}/workspaces/{tree.id}/access", headers=auth(alice))
    assert res.status_code == 200
    bob_rows = [row for row in res.json() if row["username"] == "bob"]
    assert len(bob_rows) == 2
    scoped = next(r for r in bob_rows if r["section_id"] == section.id)
    workspace_wide = next(r for r in bob_rows if r["section_id"] is None)
    assert scoped["role"] == "editor"
    assert scoped["restrictions"] == ["gallery"]
    assert workspace_wide["role"] == "viewer"


# ---------------------------------------------------------------------------
# Independent, section-scoped public links
# ---------------------------------------------------------------------------


def test_two_section_public_links_are_independently_passworded(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)
    section_a = _section(db, tree, "A")
    section_b = _section(db, tree, "B")
    link_a = create_section_public_link(db, workspace_id=tree.id, section_id=section_a.id)
    link_b = create_section_public_link(db, workspace_id=tree.id, section_id=section_b.id)
    set_section_public_link_password(link_a, "password-a1")
    set_section_public_link_password(link_b, "password-b1")
    db.commit()

    # Workspace has no public_role set: still readable, because *some* public
    # grant exists (coarse gate — which section a caller may see is #984's job).
    denied = client.get(f"{API}/workspaces/{tree.id}")
    assert denied.status_code == 401
    assert denied.json()["detail"] == "public_password_required"

    # Wrong link's password doesn't unlock this one.
    wrong = client.post(
        f"{API}/workspaces/{tree.id}/public/unlock",
        json={"password": "password-b1", "link_id": link_a.id},
    )
    assert wrong.status_code == 401

    ok = client.post(
        f"{API}/workspaces/{tree.id}/public/unlock",
        json={"password": "password-a1", "link_id": link_a.id},
    )
    assert ok.status_code == 200
    token_a = ok.json()["token"]

    ok_b = client.post(
        f"{API}/workspaces/{tree.id}/public/unlock",
        json={"password": "password-b1", "link_id": link_b.id},
    )
    assert ok_b.status_code == 200
    token_b = ok_b.json()["token"]
    assert token_a != token_b

    granted = client.get(
        f"{API}/workspaces/{tree.id}", headers={"X-Public-Workspace-Token": token_a}
    )
    assert granted.status_code == 200


def test_revoking_one_section_public_link_does_not_affect_another(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)
    section_a = _section(db, tree, "A")
    section_b = _section(db, tree, "B")
    link_a = create_section_public_link(db, workspace_id=tree.id, section_id=section_a.id)
    link_b = create_section_public_link(db, workspace_id=tree.id, section_id=section_b.id)
    db.commit()

    assert {g.id for g in active_public_grants(db, tree)} == {link_a.id, link_b.id}

    revoke_section_public_link(link_a)
    db.commit()

    remaining = {g.id for g in active_public_grants(db, tree)}
    assert remaining == {link_b.id}


# ---------------------------------------------------------------------------
# scope_audience narrows by section (through the existing preview endpoint)
# ---------------------------------------------------------------------------


def test_scope_audience_narrows_to_section_grant_holders(db):
    from app.services.provenance import scope_audience

    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    carol = make_user(db, "carol")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    _grant(db, tree, section, bob, role="viewer")
    # carol has no access at all.

    audience = scope_audience(db, tree, section.id)
    assert bob.id in audience
    assert carol.id not in audience
    assert alice.id in audience

    # Workspace-wide content is readable by anyone with any access, scoped or
    # not — bob shows up here too even though his grant is section-scoped.
    workspace_wide_audience = scope_audience(db, tree, None)
    assert bob.id in workspace_wide_audience


def test_rescope_preview_reports_the_destination_sections_audience(client, db):
    from uuid import uuid4

    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    section = _section(db, tree)
    _grant(db, tree, section, bob, role="viewer")

    event_res = client.post(
        f"{API}/workspaces/{tree.id}/events",
        headers=auth(alice),
        json={
            "id": str(uuid4()),
            "event_type": "birth",
            "date": "1900-01-01",
            "created_at": "2026-01-01T00:00:00+00:00",
            "member_ids": [],
        },
    )
    assert event_res.status_code == 201, event_res.text
    event_id = event_res.json()["id"]

    preview = client.post(
        f"{API}/workspaces/{tree.id}/content-scopes/preview",
        headers=auth(alice),
        json={
            "items": [{"content_type": "event", "content_id": event_id}],
            "section_id": section.id,
        },
    )
    assert preview.status_code == 200, preview.text
    change = preview.json()["changes"][0]
    # Moving from workspace-wide (everyone) into the section: bob (scoped
    # there) is in the destination audience but so is alice the owner;
    # narrowing is visible in the two audiences differing at all.
    assert bob.id in change["audience_after"]
    assert set(change["audience_after"]) <= set(change["audience_before"])
