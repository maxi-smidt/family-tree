"""Focused unit tests for the vital-event mirror helper (see
app.services.members.member_vitals), used by both the single-member update
workflow and member merge (#893)."""

from app.models import Event, EventMemberLink, WorkspaceMembership
from app.services.members.member_vitals import event_updates_allowed, sync_vital_event
from tests.conftest import add_member, make_tree, make_user


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
