"""Content provenance across section scopes (#1023)."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import ContentScope, ContentType, Section, SectionMember
from app.services.provenance import scope_of
from tests.conftest import API, add_member, auth, make_tree, make_user


def _section(client, user, tree, name="Vienna branch"):
    res = client.post(
        f"{API}/workspaces/{tree.id}/sections",
        headers=auth(user),
        json={"name": name},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_event(client, user, tree, *, member_ids=(), origin_section_id=None):
    url = f"{API}/workspaces/{tree.id}/events"
    if origin_section_id is not None:
        url += f"?origin_section_id={origin_section_id}"
    res = client.post(
        url,
        headers=auth(user),
        json={
            "id": str(uuid4()),
            "event_type": "birth",
            "date": "1900-01-01",
            "created_at": "2026-01-01T00:00:00+00:00",
            "member_ids": list(member_ids),
        },
    )
    return res


def _scope_row(db, content_type, content_id):
    db.expire_all()
    return db.get(ContentScope, (str(content_type), content_id))


# ---------------------------------------------------------------------------
# Recording
# ---------------------------------------------------------------------------


def test_content_created_outside_a_section_is_workspace_wide(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")

    res = _create_event(client, user, tree, member_ids=["m1"])
    assert res.status_code == 201, res.text

    scope = _scope_row(db, ContentType.EVENT, res.json()["id"])
    assert scope is not None
    assert scope.workspace_id == tree.id
    assert scope.section_id is None


def test_content_created_in_a_section_context_inherits_that_section(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_id = _section(client, user, tree)

    res = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=section_id
    )
    assert res.status_code == 201, res.text
    assert _scope_row(db, ContentType.EVENT, res.json()["id"]).section_id == section_id


def test_every_content_domain_is_recorded(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_id = _section(client, user, tree)
    headers = auth(user)
    base = f"{API}/workspaces/{tree.id}"
    query = f"?origin_section_id={section_id}"

    created: dict[ContentType, str] = {}

    res = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=section_id
    )
    created[ContentType.EVENT] = res.json()["id"]

    res = client.post(
        f"{base}/stories{query}",
        headers=headers,
        json={
            "id": str(uuid4()),
            "title": "A story",
            "content": "text",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
            "member_ids": ["m1"],
        },
    )
    assert res.status_code == 201, res.text
    created[ContentType.STORY] = res.json()["id"]

    res = client.post(
        f"{base}/tasks{query}",
        headers=headers,
        json={
            "id": str(uuid4()),
            "title": "Find the record",
            "created_at": "2026-01-01T00:00:00+00:00",
            "member_ids": ["m1"],
        },
    )
    assert res.status_code == 201, res.text
    created[ContentType.TASK] = res.json()["id"]

    res = client.post(
        f"{base}/diseases{query}",
        headers=headers,
        json={
            "id": str(uuid4()),
            "member_id": "m1",
            "name": "Asthma",
            "carrier_status": "affected",
        },
    )
    assert res.status_code == 201, res.text
    created[ContentType.DISEASE] = res.json()["id"]

    res = client.post(
        f"{base}/documents{query}",
        headers=headers,
        json={"title": "Birth certificate"},
    )
    assert res.status_code == 201, res.text
    created[ContentType.DOCUMENT] = res.json()["id"]

    for content_type, content_id in created.items():
        scope = _scope_row(db, content_type, content_id)
        assert scope is not None, content_type
        assert scope.section_id == section_id, content_type


def test_scope_is_recorded_once_and_survives_an_update(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_id = _section(client, user, tree)
    event_id = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=section_id
    ).json()["id"]

    # An update carrying no section context must not silently widen the origin.
    res = client.patch(
        f"{API}/workspaces/{tree.id}/events/{event_id}",
        headers=auth(user),
        json={"event_type": "death", "date": "1980-01-01"},
    )
    assert res.status_code == 200, res.text
    assert _scope_row(db, ContentType.EVENT, event_id).section_id == section_id


def test_linking_a_boundary_member_never_widens_the_origin(client, db):
    """The heart of #1023: A-origin content stays A-origin when its member
    joins section B."""
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "boundary")
    section_a = _section(client, user, tree, "A")
    section_b = _section(client, user, tree, "B")
    event_id = _create_event(
        client, user, tree, member_ids=["boundary"], origin_section_id=section_a
    ).json()["id"]

    res = client.put(
        f"{API}/workspaces/{tree.id}/sections/{section_b}/members",
        headers=auth(user),
        json={"member_ids": ["boundary"]},
    )
    assert res.status_code == 204, res.text
    assert db.get(SectionMember, (section_b, "boundary")) is not None
    assert _scope_row(db, ContentType.EVENT, event_id).section_id == section_a


def test_deleting_content_drops_its_scope(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    event_id = _create_event(client, user, tree, member_ids=["m1"]).json()["id"]

    res = client.delete(
        f"{API}/workspaces/{tree.id}/events/{event_id}", headers=auth(user)
    )
    assert res.status_code == 204, res.text
    assert _scope_row(db, ContentType.EVENT, event_id) is None


def test_deleting_a_member_drops_its_disease_scopes(client, db):
    """Diseases vanish through a database cascade, which raises no ORM event."""
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_id = _section(client, user, tree)
    disease_id = client.post(
        f"{API}/workspaces/{tree.id}/diseases?origin_section_id={section_id}",
        headers=auth(user),
        json={
            "id": str(uuid4()),
            "member_id": "m1",
            "name": "Asthma",
            "carrier_status": "affected",
        },
    ).json()["id"]

    res = client.delete(f"{API}/workspaces/{tree.id}/members/m1", headers=auth(user))
    assert res.status_code == 204, res.text
    assert _scope_row(db, ContentType.DISEASE, disease_id) is None


# ---------------------------------------------------------------------------
# Database constraints
# ---------------------------------------------------------------------------


def test_scope_pointing_at_another_workspaces_section_is_rejected(db):
    user = make_user(db)
    tree = make_tree(db, user, "One")
    other = make_tree(db, user, "Two")
    section = Section(workspace_id=other.id, name="Elsewhere", position=0)
    db.add(section)
    db.commit()

    db.add(
        ContentScope(
            content_type=str(ContentType.EVENT),
            content_id="e1",
            workspace_id=tree.id,
            section_id=section.id,
            created_at="2026-01-01T00:00:00+00:00",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_scope_pointing_at_a_missing_section_is_rejected(db):
    user = make_user(db)
    tree = make_tree(db, user)

    db.add(
        ContentScope(
            content_type=str(ContentType.EVENT),
            content_id="e1",
            workspace_id=tree.id,
            section_id="does-not-exist",
            created_at="2026-01-01T00:00:00+00:00",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_requesting_a_section_from_another_workspace_is_rejected(client, db):
    user = make_user(db)
    tree = make_tree(db, user, "One")
    other = make_tree(db, user, "Two")
    add_member(db, tree, "m1")
    foreign_section = _section(client, user, other)

    res = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=foreign_section
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Section deletion
# ---------------------------------------------------------------------------


def test_section_delete_is_blocked_while_it_holds_content(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_id = _section(client, user, tree)
    _create_event(client, user, tree, member_ids=["m1"], origin_section_id=section_id)

    res = client.get(
        f"{API}/workspaces/{tree.id}/sections/{section_id}/dependents",
        headers=auth(user),
    )
    assert res.status_code == 200
    assert res.json()["content_scope_counts"] == {"event": 1}

    res = client.delete(
        f"{API}/workspaces/{tree.id}/sections/{section_id}", headers=auth(user)
    )
    assert res.status_code == 409
    assert db.get(Section, section_id) is not None


def test_section_delete_reassigns_content_to_another_section(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_a = _section(client, user, tree, "A")
    section_b = _section(client, user, tree, "B")
    event_id = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=section_a
    ).json()["id"]

    res = client.delete(
        f"{API}/workspaces/{tree.id}/sections/{section_a}"
        f"?reassign_scope_to={section_b}",
        headers=auth(user),
    )
    assert res.status_code == 204, res.text
    assert db.get(Section, section_a) is None
    assert _scope_row(db, ContentType.EVENT, event_id).section_id == section_b


def test_empty_section_still_deletes(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    section_id = _section(client, user, tree)

    res = client.delete(
        f"{API}/workspaces/{tree.id}/sections/{section_id}", headers=auth(user)
    )
    assert res.status_code == 204, res.text
    assert db.get(Section, section_id) is None


# ---------------------------------------------------------------------------
# Re-scoping
# ---------------------------------------------------------------------------


def test_rescope_requires_the_owner(client, db):
    user = make_user(db)
    editor = make_user(db, "bob")
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_id = _section(client, user, tree)
    event_id = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=section_id
    ).json()["id"]

    from tests.conftest import share

    share(db, tree, editor, "editor")
    res = client.post(
        f"{API}/workspaces/{tree.id}/content-scopes",
        headers=auth(editor),
        json={
            "items": [{"content_type": "event", "content_id": event_id}],
            "section_id": None,
        },
    )
    assert res.status_code == 403
    assert _scope_row(db, ContentType.EVENT, event_id).section_id == section_id


def test_owner_rescope_previews_and_applies(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_a = _section(client, user, tree, "A")
    section_b = _section(client, user, tree, "B")
    event_id = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=section_a
    ).json()["id"]
    body = {
        "items": [{"content_type": "event", "content_id": event_id}],
        "section_id": section_b,
    }

    res = client.post(
        f"{API}/workspaces/{tree.id}/content-scopes/preview",
        headers=auth(user),
        json=body,
    )
    assert res.status_code == 200, res.text
    change = res.json()["changes"][0]
    assert change["from_section_id"] == section_a
    assert change["to_section_id"] == section_b
    assert change["widens"] is False
    # Preview alone changes nothing.
    assert _scope_row(db, ContentType.EVENT, event_id).section_id == section_a

    res = client.post(
        f"{API}/workspaces/{tree.id}/content-scopes", headers=auth(user), json=body
    )
    assert res.status_code == 200, res.text
    assert _scope_row(db, ContentType.EVENT, event_id).section_id == section_b


def test_rescope_to_workspace_wide_is_flagged_as_widening(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_id = _section(client, user, tree)
    event_id = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=section_id
    ).json()["id"]

    res = client.post(
        f"{API}/workspaces/{tree.id}/content-scopes/preview",
        headers=auth(user),
        json={
            "items": [{"content_type": "event", "content_id": event_id}],
            "section_id": None,
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["changes"][0]["widens"] is True


def test_list_scopes_filters_by_section(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_id = _section(client, user, tree)
    scoped = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=section_id
    ).json()["id"]
    _create_event(client, user, tree, member_ids=["m1"])

    res = client.get(
        f"{API}/workspaces/{tree.id}/content-scopes?section_id={section_id}",
        headers=auth(user),
    )
    assert res.status_code == 200
    assert [row["content_id"] for row in res.json()] == [scoped]


# ---------------------------------------------------------------------------
# Activity / undo
# ---------------------------------------------------------------------------


def test_undo_restores_the_original_origin_scope(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_id = _section(client, user, tree)
    event_id = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=section_id
    ).json()["id"]

    res = client.delete(
        f"{API}/workspaces/{tree.id}/events/{event_id}", headers=auth(user)
    )
    assert res.status_code == 204, res.text

    entries = client.get(
        f"{API}/workspaces/{tree.id}/activity", headers=auth(user)
    ).json()
    entry = next(
        e
        for e in entries["entries"]
        if e["action"] == "delete" and e["target_type"] == "event"
    )
    res = client.post(
        f"{API}/workspaces/{tree.id}/activity/{entry['id']}/undo", headers=auth(user)
    )
    assert res.status_code == 200, res.text
    assert _scope_row(db, ContentType.EVENT, event_id).section_id == section_id


def test_undo_falls_back_to_workspace_wide_when_the_section_is_gone(client, db):
    user = make_user(db)
    tree = make_tree(db, user)
    add_member(db, tree, "m1")
    section_id = _section(client, user, tree)
    event_id = _create_event(
        client, user, tree, member_ids=["m1"], origin_section_id=section_id
    ).json()["id"]
    client.delete(f"{API}/workspaces/{tree.id}/events/{event_id}", headers=auth(user))
    client.delete(
        f"{API}/workspaces/{tree.id}/sections/{section_id}", headers=auth(user)
    )

    entries = client.get(
        f"{API}/workspaces/{tree.id}/activity", headers=auth(user)
    ).json()
    entry = next(
        e
        for e in entries["entries"]
        if e["action"] == "delete" and e["target_type"] == "event"
    )
    res = client.post(
        f"{API}/workspaces/{tree.id}/activity/{entry['id']}/undo", headers=auth(user)
    )
    assert res.status_code == 200, res.text
    assert _scope_row(db, ContentType.EVENT, event_id).section_id is None


# ---------------------------------------------------------------------------
# Service-level resolution
# ---------------------------------------------------------------------------


def test_a_scoped_caller_never_gets_a_workspace_wide_origin(client, db):
    """#993 will pass a real permitted set; the rule it relies on is here."""
    from app.services.provenance import resolve_origin_section

    user = make_user(db)
    tree = make_tree(db, user)
    section_a = _section(client, user, tree, "A")
    section_b = _section(client, user, tree, "B")

    assert resolve_origin_section(db, tree, None) is None
    assert (
        resolve_origin_section(db, tree, None, permitted_section_ids={section_b})
        == section_b
    )
    # Several permitted sections and no stated context: the first by display
    # order, deterministically — never workspace-wide.
    assert (
        resolve_origin_section(
            db, tree, None, permitted_section_ids={section_a, section_b}
        )
        == section_a
    )


def test_a_scoped_caller_with_no_permitted_sections_is_rejected_not_widened(client, db):
    """An empty permitted set must never fall back to workspace-wide."""
    from app.core.exceptions import InvalidInputError
    from app.services.provenance import resolve_origin_section

    user = make_user(db)
    tree = make_tree(db, user)

    with pytest.raises(InvalidInputError):
        resolve_origin_section(db, tree, None, permitted_section_ids=set())


def test_a_scoped_caller_cannot_name_a_section_outside_their_scope(client, db):
    from app.core.exceptions import InvalidInputError
    from app.services.provenance import resolve_origin_section

    user = make_user(db)
    tree = make_tree(db, user)
    section_a = _section(client, user, tree, "A")
    section_b = _section(client, user, tree, "B")

    with pytest.raises(InvalidInputError):
        resolve_origin_section(
            db, tree, section_a, permitted_section_ids={section_b}
        )


def test_scope_of_returns_none_for_unknown_content(db):
    assert scope_of(db, ContentType.EVENT, "nope") is None
