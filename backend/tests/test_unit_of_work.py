"""UnitOfWork (#897): a single owner for commit/rollback and the events /
cache invalidation that must only ever follow a *successful* commit.

Isolated tests exercise the primitive directly; the route-level tests replay
a commit failure through the two domains migrated onto it (stories, events)
and assert the invariant end to end: no event is published and no row is
left behind for a mutation that didn't actually land.
"""

from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.api.routes import friends
from app.api.routes.events import create_event, delete_event, set_links
from app.api.routes.member_diseases import add_disease
from app.api.routes.members import create_member
from app.api.routes.stories import create_story, delete_story
from app.api.routes.tasks import create_task
from app.api.routes.workspace_sharing import share_tree
from app.api.routes.workspaces import create_tree
from app.models import Event, Member, MemberDisease, MemberTask, Story, Workspace
from app.schemas.content import EventCreate, LinksSet, MemberTaskCreate, StoryCreate
from app.schemas.family import DiseaseCreate, MemberCreate
from app.schemas.workspace import WorkspaceCreate, WorkspaceShare
from app.services.unit_of_work import UnitOfWork
from tests.conftest import add_member, befriend, make_tree, make_user

_TS = "2000-01-01T00:00:00Z"

# ---------------------------------------------------------------------------
# UnitOfWork primitive
# ---------------------------------------------------------------------------


def test_commits_and_runs_callbacks_in_order(db, owner):
    calls: list[int] = []
    with UnitOfWork(db) as uow:
        db.add(Workspace(id="uow-t1", name="T", owner_id=owner.id))
        uow.after_commit(lambda: calls.append(1))
        uow.after_commit(lambda: calls.append(2))
    assert calls == [1, 2]
    assert db.get(Workspace, "uow-t1") is not None


def test_exception_in_block_rolls_back_and_skips_callbacks(db, owner, session_factory):
    calls: list[int] = []
    with pytest.raises(ValueError):
        with UnitOfWork(db) as uow:
            db.add(Workspace(id="uow-t2", name="T", owner_id=owner.id))
            uow.after_commit(lambda: calls.append(1))
            raise ValueError("boom")
    assert calls == []
    fresh = session_factory()
    try:
        assert fresh.get(Workspace, "uow-t2") is None
    finally:
        fresh.close()


def test_commit_failure_rolls_back_and_skips_callbacks(db, owner, monkeypatch):
    callback_calls: list[int] = []
    rollback_calls: list[bool] = []
    real_rollback = db.rollback

    def boom():
        raise RuntimeError("simulated commit failure")

    def spy_rollback():
        rollback_calls.append(True)
        real_rollback()

    monkeypatch.setattr(db, "commit", boom)
    monkeypatch.setattr(db, "rollback", spy_rollback)

    with pytest.raises(RuntimeError):
        with UnitOfWork(db) as uow:
            uow.after_commit(lambda: callback_calls.append(1))
    assert callback_calls == []
    # The UoW itself must roll back a failed commit — the caller shouldn't
    # have to remember to do it after catching the exception.
    assert rollback_calls == [True]


def test_reusing_uow_after_failure_does_not_replay_stale_callbacks(db, owner):
    """A callback queued by a rolled-back block must never fire — not even
    when the same UnitOfWork instance goes on to commit a later mutation."""
    calls: list[str] = []
    uow = UnitOfWork(db)

    with pytest.raises(ValueError):
        with uow:
            db.add(Workspace(id="uow-t3", name="T", owner_id=owner.id))
            uow.after_commit(lambda: calls.append("stale"))
            raise ValueError("boom")
    assert calls == []

    with uow:
        db.add(Workspace(id="uow-t4", name="T", owner_id=owner.id))
        uow.after_commit(lambda: calls.append("fresh"))
    assert calls == ["fresh"]
    assert db.get(Workspace, "uow-t3") is None
    assert db.get(Workspace, "uow-t4") is not None


# ---------------------------------------------------------------------------
# Failure injection through the migrated routes
# ---------------------------------------------------------------------------


def test_create_story_commit_failure_leaves_no_row_and_publishes_nothing(
    db, owner, session_factory, monkeypatch
):
    tree = make_tree(db, owner)
    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("boom")))

    with patch("app.api.routes.stories.publish_workspace_event") as published:
        with pytest.raises(RuntimeError):
            create_story(
                StoryCreate(id="s1", title="A tale", created_at=_TS, updated_at=_TS),
                tree=tree,
                user=owner,
                db=db,
            )
    published.assert_not_called()

    # No manual db.rollback() here: the UnitOfWork must have already rolled
    # back the failed commit on its own.
    fresh = session_factory()
    try:
        assert fresh.get(Story, "s1") is None
    finally:
        fresh.close()


def test_delete_story_commit_failure_leaves_story_intact(db, owner, monkeypatch):
    tree = make_tree(db, owner)
    create_story(
        StoryCreate(id="s2", title="Keep me", created_at=_TS, updated_at=_TS),
        tree=tree,
        user=owner,
        db=db,
    )

    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    with patch("app.api.routes.stories.publish_workspace_event") as published:
        with pytest.raises(RuntimeError):
            delete_story("s2", tree=tree, user=owner, db=db)
    published.assert_not_called()

    # No manual db.rollback() here: the UnitOfWork must have already rolled
    # back the failed commit on its own.
    assert db.get(Story, "s2") is not None


def test_create_event_commit_failure_leaves_no_row_and_publishes_nothing(
    db, owner, session_factory, monkeypatch
):
    tree = make_tree(db, owner)
    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("boom")))

    with patch("app.api.routes.events.publish_workspace_event") as published:
        with pytest.raises(RuntimeError):
            create_event(
                EventCreate(id="e1", event_type="birth", date="2000", created_at=_TS),
                tree=tree,
                user=owner,
                db=db,
            )
    published.assert_not_called()

    # No manual db.rollback() here: the UnitOfWork must have already rolled
    # back the failed commit on its own.
    fresh = session_factory()
    try:
        assert fresh.get(Event, "e1") is None
    finally:
        fresh.close()


def test_delete_event_commit_failure_leaves_event_intact(db, owner, monkeypatch):
    tree = make_tree(db, owner)
    create_event(
        EventCreate(id="e2", event_type="birth", date="2000", created_at=_TS),
        tree=tree,
        user=owner,
        db=db,
    )

    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    with patch("app.api.routes.events.publish_workspace_event") as published:
        with pytest.raises(RuntimeError):
            delete_event("e2", tree=tree, user=owner, db=db)
    published.assert_not_called()

    # No manual db.rollback() here: the UnitOfWork must have already rolled
    # back the failed commit on its own.
    assert db.get(Event, "e2") is not None


def test_create_story_link_failure_rolls_back_the_whole_mutation(
    db, owner, session_factory
):
    """The row construction, flush and link replacement all happen inside the
    UnitOfWork block now, so a failure among them must roll back the story
    row too — not just skip the commit that would have followed it."""
    tree = make_tree(db, owner)

    with patch(
        "app.api.routes.stories.replace_member_links",
        side_effect=RuntimeError("boom"),
    ):
        with patch("app.api.routes.stories.publish_workspace_event") as published:
            with pytest.raises(RuntimeError):
                create_story(
                    StoryCreate(
                        id="s3", title="Never lands", created_at=_TS, updated_at=_TS
                    ),
                    tree=tree,
                    user=owner,
                    db=db,
                )
    published.assert_not_called()

    fresh = session_factory()
    try:
        assert fresh.get(Story, "s3") is None
    finally:
        fresh.close()


def test_set_links_on_event_emits_content_changed(db, owner):
    """Regression: set_links used to commit without publishing at all, so
    collaborators never saw a live update for a member-link change."""
    tree = make_tree(db, owner)
    create_event(
        EventCreate(id="e3", event_type="birth", date="2000", created_at=_TS),
        tree=tree,
        user=owner,
        db=db,
    )

    with patch("app.api.routes.events.publish_workspace_event") as published:
        set_links("e3", LinksSet(member_ids=[]), tree=tree, user=owner, db=db)

    event_types = [c.args[2] for c in published.call_args_list]
    assert "workspace.content_changed" in event_types


# ---------------------------------------------------------------------------
# Failure injection across the #952 migration (representative sample — the
# same commit-failure idiom as above, replayed through a few more domains
# that were converted onto UnitOfWork).
# ---------------------------------------------------------------------------


def test_create_member_commit_failure_leaves_no_row_and_publishes_nothing(
    db, owner, session_factory, monkeypatch
):
    tree = make_tree(db, owner)
    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("boom")))

    with patch("app.api.routes.members.publish_workspace_event") as published:
        with pytest.raises(RuntimeError):
            create_member(
                MemberCreate(id="m1", first_name="A"), tree=tree, user=owner, db=db
            )
    published.assert_not_called()

    fresh = session_factory()
    try:
        assert fresh.get(Member, "m1") is None
    finally:
        fresh.close()


def test_create_task_commit_failure_leaves_no_row_and_notifies_nothing(
    db, owner, session_factory, monkeypatch
):
    tree = make_tree(db, owner)
    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("boom")))

    with patch("app.api.routes.tasks._notify") as notified:
        with pytest.raises(RuntimeError):
            create_task(
                MemberTaskCreate(id="t1", title="Do it", created_at=_TS),
                tree=tree,
                user=owner,
                db=db,
            )
    notified.assert_not_called()

    fresh = session_factory()
    try:
        assert fresh.get(MemberTask, "t1") is None
    finally:
        fresh.close()


def test_add_disease_commit_failure_leaves_no_row_and_publishes_nothing(
    db, owner, session_factory, monkeypatch
):
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="A")
    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("boom")))

    with patch("app.api.routes.member_diseases.publish_workspace_event") as published:
        with pytest.raises(RuntimeError):
            add_disease(
                DiseaseCreate(
                    id="d1", member_id="m1", name="X", carrier_status="unknown"
                ),
                tree=tree,
                user=owner,
                db=db,
            )
    published.assert_not_called()

    fresh = session_factory()
    try:
        assert fresh.get(MemberDisease, "d1") is None
    finally:
        fresh.close()


def test_create_tree_commit_failure_leaves_no_row_and_publishes_nothing(
    db, owner, session_factory, monkeypatch
):
    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("boom")))

    with patch("app.api.routes.workspaces.publish_workspace_event") as published:
        with pytest.raises(RuntimeError):
            create_tree(WorkspaceCreate(name="New tree"), user=owner, db=db)
    published.assert_not_called()

    fresh = session_factory()
    try:
        assert fresh.scalar(select(Workspace).where(Workspace.name == "New tree")) is None
    finally:
        fresh.close()


def test_share_tree_commit_failure_grants_no_access_and_notifies_nothing(
    db, owner, session_factory, monkeypatch
):
    tree = make_tree(db, owner)
    bob = make_user(db, "bob")
    befriend(db, owner, bob)
    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("boom")))

    with patch("app.api.routes.workspace_sharing.publish_workspace_event") as published:
        with pytest.raises(RuntimeError):
            share_tree(WorkspaceShare(username="bob"), tree=tree, user=owner, db=db)
    published.assert_not_called()

    fresh = session_factory()
    try:
        assert fresh.get(Workspace, tree.id).memberships == []
    finally:
        fresh.close()


def test_accept_friend_request_commit_failure_stays_pending_and_notifies_nothing(
    db, owner, session_factory, monkeypatch
):
    other = make_user(db, "bob")
    friendship = befriend(db, other, owner, status="pending")
    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("boom")))

    with patch(
        "app.api.routes.friends.notification_service.create_notification"
    ) as notified:
        with pytest.raises(RuntimeError):
            friends.accept_request(other.id, user=owner, db=db)
    notified.assert_not_called()

    fresh = session_factory()
    try:
        pk = (friendship.requester_id, friendship.addressee_id)
        reloaded = fresh.get(type(friendship), pk)
        assert reloaded.status == "pending"
    finally:
        fresh.close()
