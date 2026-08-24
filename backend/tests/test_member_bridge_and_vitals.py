"""Focused unit tests for the extracted bridge-sync and vital-event helpers
(see app.services.members.bridge and app.services.members.member_vitals), used by both the
single-member update workflow and member merge (#893)."""

import pytest

from app.core.exceptions import AccessDeniedError, InvalidInputError, NotFoundError
from app.models import Event, EventMemberLink, WorkspaceMembership
from app.services.members.bridge import (
    sync_bridge_person,
    validate_linked_member,
    validate_linked_tree,
)
from app.services.members.member_vitals import event_updates_allowed, sync_vital_event
from tests.conftest import add_member, make_tree, make_user, share


def _linked_pair(db, first_name="Ada", last_name="Lovelace"):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")
    # Both rows must exist before either can point at the other's id (FK).
    member = add_member(db, tree_a, "m1", first_name=first_name, last_name=last_name)
    counterpart = add_member(db, tree_b, "m2", first_name=first_name, last_name=last_name)
    member.linked_workspace_id = tree_b.id
    member.linked_member_id = "m2"
    counterpart.linked_workspace_id = tree_a.id
    counterpart.linked_member_id = "m1"
    db.commit()
    return user, tree_a, tree_b, member, counterpart


# --- sync_bridge_person ------------------------------------------------------


def test_sync_bridge_person_noop_without_a_link(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    member = add_member(db, tree, "m1", first_name="Ada")
    status, synced_tree = sync_bridge_person(db, member, {"first_name": "Eve"}, user)
    assert (status, synced_tree) == (None, None)


def test_sync_bridge_person_noop_when_no_identity_field_changed(db):
    user, tree_a, _tree_b, member, _counterpart = _linked_pair(db)
    # position_x is not a BRIDGE_SYNC_FIELDS member.
    status, synced_tree = sync_bridge_person(db, member, {"position_x": 5.0}, user)
    assert (status, synced_tree) == (None, None)


def test_sync_bridge_person_copies_identity_fields_onto_counterpart(db):
    user, _tree_a, tree_b, member, counterpart = _linked_pair(db)
    status, synced_tree = sync_bridge_person(db, member, {"first_name": "Eve"}, user)
    assert status == "synced"
    assert synced_tree.id == tree_b.id
    assert counterpart.first_name == "Eve"


def test_sync_bridge_person_skips_without_write_access_to_counterpart_tree(db):
    user, tree_a, tree_b, member, counterpart = _linked_pair(db)
    editor = make_user(db, "bob")
    share(db, tree_a, editor, role="editor")
    # `editor` can write tree_a (where `member` lives) but has no access to
    # tree_b at all, so the counterpart edit must be reported, not silently
    # dropped or applied.
    status, synced_tree = sync_bridge_person(db, member, {"first_name": "Eve"}, editor)
    assert (status, synced_tree) == ("skipped_no_access", None)
    assert counterpart.first_name != "Eve"


# --- validate_linked_tree / validate_linked_member ---------------------------


def test_validate_linked_tree_allows_none(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    validate_linked_tree(db, tree, user, None)  # must not raise


def test_validate_linked_tree_rejects_self_link(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    with pytest.raises(InvalidInputError):
        validate_linked_tree(db, tree, user, tree.id)


def test_validate_linked_tree_rejects_missing_target(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    with pytest.raises(NotFoundError):
        validate_linked_tree(db, tree, user, "does-not-exist")


def test_validate_linked_tree_rejects_inaccessible_target(db):
    user = make_user(db, "alice")
    other_owner = make_user(db, "bob")
    tree = make_tree(db, user)
    other = make_tree(db, other_owner, "Other")
    with pytest.raises(AccessDeniedError):
        validate_linked_tree(db, tree, user, other.id)


def test_validate_linked_member_allows_none(db):
    validate_linked_member(db, None, None, "m1")  # must not raise


def test_validate_linked_member_requires_a_linked_tree(db):
    with pytest.raises(InvalidInputError):
        validate_linked_member(db, None, "m2", "m1")


def test_validate_linked_member_rejects_self_link(db):
    with pytest.raises(InvalidInputError):
        validate_linked_member(db, "tree-b", "m1", "m1")


def test_validate_linked_member_rejects_member_outside_linked_tree(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    other = make_tree(db, user, "Other")
    add_member(db, tree, "m2", first_name="Ada")  # lives in `tree`, not `other`
    with pytest.raises(InvalidInputError):
        validate_linked_member(db, other.id, "m2", "m1")


# --- vital-event mirror -------------------------------------------------------


def _birth_event(db, tree, member):
    return (
        db.query(Event)
        .join(EventMemberLink)
        .filter(
            Event.workspace_id == tree.id,
            Event.event_type == "birth",
            EventMemberLink.member_id == member.id,
        )
        .one_or_none()
    )


def test_sync_vital_event_creates_event_when_a_date_is_set(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    member = add_member(db, tree, "m1", first_name="Ada")
    sync_vital_event(db, tree, member, "birth", "1990", "London")
    db.commit()
    event = _birth_event(db, tree, member)
    assert event is not None
    assert event.date == "1990"
    assert event.location == "London"


def test_sync_vital_event_preserves_user_authored_location(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    member = add_member(db, tree, "m1", first_name="Ada")
    sync_vital_event(db, tree, member, "birth", "1990", "London")
    db.commit()
    event = _birth_event(db, tree, member)
    event.location = "Paris"  # user edits the mirrored event directly
    db.commit()

    sync_vital_event(db, tree, member, "birth", "1991", "Berlin")
    db.commit()
    event = _birth_event(db, tree, member)
    assert event.date == "1991"
    assert event.location == "Paris"  # not overwritten (#769)


def test_sync_vital_event_deletes_event_when_date_cleared(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    member = add_member(db, tree, "m1", first_name="Ada")
    sync_vital_event(db, tree, member, "birth", "1990", "London")
    db.commit()

    sync_vital_event(db, tree, member, "birth", None, None)
    db.commit()
    assert _birth_event(db, tree, member) is None


def test_event_updates_allowed_false_when_editor_is_restricted(db):
    owner = make_user(db, "alice")
    editor = make_user(db, "bob")
    tree = make_tree(db, owner)
    db.add(
        WorkspaceMembership(
            workspace_id=tree.id,
            user_id=editor.id,
            role="editor",
            restrictions=["events"],
        )
    )
    db.commit()
    assert event_updates_allowed(db, tree, editor) is False


def test_event_updates_allowed_true_by_default(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    assert event_updates_allowed(db, tree, user) is True
