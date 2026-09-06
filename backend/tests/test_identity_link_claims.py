"""Tests for identity link claims (#1014) — see app.services.identity_link_claims."""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import AccessDeniedError, ConflictError, InvalidInputError
from app.db.base import new_uuid
from app.models.identity_link import IdentityLinkStatus
from app.models.identity_link_claim import IdentityLinkClaim, IdentityLinkClaimStatus
from app.models.notification import Notification
from app.services.identity_link_claims import (
    cancel_claim,
    complete_claim,
    decline_claim,
    expire_stale_claims,
    list_incoming_claims,
    list_outgoing_claims,
    propose_claim,
)
from app.services.members.member_merge import merge_members_in_place
from tests.conftest import API, add_member, auth, befriend, make_tree, make_user, share


def _friends_pair(db):
    """Two friends who each own a workspace neither can read the other's."""
    proposer = make_user(db, "alice")
    target = make_user(db, "bob")
    befriend(db, proposer, target)
    proposer_tree = make_tree(db, proposer, "A")
    target_tree = make_tree(db, target, "B")
    source_member = add_member(db, proposer_tree, "ma", first_name="Ada")
    return proposer, target, proposer_tree, target_tree, source_member


def test_propose_requires_an_accepted_friend(db):
    proposer = make_user(db, "alice")
    make_user(db, "bob")
    tree = make_tree(db, proposer)
    member = add_member(db, tree, "ma", first_name="Ada")

    with pytest.raises(AccessDeniedError):
        propose_claim(db, proposer, tree, member, "bob")


def test_propose_unknown_username_matches_the_not_a_friend_error(db):
    """Non-enumerating: a nonexistent user and a non-friend must raise the
    identical error so a caller can't distinguish the two."""
    proposer = make_user(db, "alice")
    tree = make_tree(db, proposer)
    member = add_member(db, tree, "ma", first_name="Ada")

    with pytest.raises(AccessDeniedError) as unknown_exc:
        propose_claim(db, proposer, tree, member, "nobody")

    make_user(db, "bob")
    with pytest.raises(AccessDeniedError) as not_friend_exc:
        propose_claim(db, proposer, tree, member, "bob")

    assert str(unknown_exc.value) == str(not_friend_exc.value)


def test_propose_records_source_approval_for_an_owner(db):
    proposer, target, tree, _target_tree, member = _friends_pair(db)
    claim = propose_claim(db, proposer, tree, member, target.username)
    assert claim.status == IdentityLinkClaimStatus.PENDING
    assert claim.source_approved_by == proposer.id


def test_propose_twice_refreshes_the_pending_claim_instead_of_duplicating(db):
    proposer, target, tree, _target_tree, member = _friends_pair(db)
    first = propose_claim(db, proposer, tree, member, target.username, note="hi")
    second = propose_claim(db, proposer, tree, member, target.username, note="updated")
    assert first.id == second.id
    assert second.note == "updated"


def test_propose_by_a_different_proposer_conflicts(db):
    """A second proposer for the same (source member, target user) pair must
    not silently rewrite the first proposer's pending claim."""
    proposer, target, tree, _target_tree, member = _friends_pair(db)
    other_editor = make_user(db, "carol")
    share(db, tree, other_editor, role="editor")
    befriend(db, other_editor, target)
    propose_claim(db, proposer, tree, member, target.username, note="original")

    with pytest.raises(ConflictError):
        propose_claim(db, other_editor, tree, member, target.username, note="mine")

    [claim] = db.scalars(select(IdentityLinkClaim)).all()
    assert claim.proposed_by == proposer.id
    assert claim.note == "original"


def test_pending_claim_pair_is_unique_at_the_database_level(db):
    """Backstop for the application-level pre-check in propose_claim: two
    pending rows for the same (source member, target user) pair can't
    coexist even if both writers raced past the pre-check."""
    proposer, target, tree, _target_tree, member = _friends_pair(db)
    db.add(
        IdentityLinkClaim(
            id=new_uuid(),
            source_member_id=member.id,
            proposed_by=proposer.id,
            target_user_id=target.id,
            status=IdentityLinkClaimStatus.PENDING,
        )
    )
    db.commit()

    db.add(
        IdentityLinkClaim(
            id=new_uuid(),
            source_member_id=member.id,
            proposed_by=proposer.id,
            target_user_id=target.id,
            status=IdentityLinkClaimStatus.PENDING,
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_complete_creates_a_verified_link_when_both_sides_are_owners(db):
    proposer, target, tree, target_tree, member = _friends_pair(db)
    target_member = add_member(db, target_tree, "mb", first_name="Ada")
    claim = propose_claim(db, proposer, tree, member, target.username)

    link = complete_claim(db, target, claim, target_tree, target_member)

    assert link.status == IdentityLinkStatus.VERIFIED
    assert claim.status == IdentityLinkClaimStatus.COMPLETED
    assert claim.resulting_identity_link_id == link.id


def test_complete_requires_the_recipient(db):
    proposer, target, tree, target_tree, member = _friends_pair(db)
    target_member = add_member(db, target_tree, "mb", first_name="Ada")
    claim = propose_claim(db, proposer, tree, member, target.username)

    with pytest.raises(AccessDeniedError):
        complete_claim(db, proposer, claim, target_tree, target_member)


def test_complete_requires_the_chosen_workspace_owner(db):
    proposer, target, tree, target_tree, member = _friends_pair(db)
    target_member = add_member(db, target_tree, "mb", first_name="Ada")
    claim = propose_claim(db, proposer, tree, member, target.username)
    other_tree = make_tree(db, proposer, "C")

    with pytest.raises(AccessDeniedError):
        complete_claim(db, target, claim, other_tree, target_member)


def test_complete_rejects_a_member_from_a_different_workspace(db):
    proposer, target, tree, target_tree, member = _friends_pair(db)
    other_target_tree = make_tree(db, target, "C")
    other_member = add_member(db, other_target_tree, "mc", first_name="Eve")
    claim = propose_claim(db, proposer, tree, member, target.username)

    with pytest.raises(InvalidInputError):
        complete_claim(db, target, claim, target_tree, other_member)


def test_complete_notifies_the_source_owner_when_still_pending_approval(db):
    """An editor-proposed claim carries no implicit source-side approval, so
    completion leaves the link proposed — the source owner must be told
    there's something to review, the same as a direct cross-owner proposal."""
    owner = make_user(db, "erin-owner")
    editor = make_user(db, "carol")
    target = make_user(db, "bob")
    befriend(db, editor, target)
    tree = make_tree(db, owner)
    share(db, tree, editor, role="editor")
    member = add_member(db, tree, "ma", first_name="Ada")
    target_tree = make_tree(db, target, "B")
    target_member = add_member(db, target_tree, "mb", first_name="Ada")
    claim = propose_claim(db, editor, tree, member, target.username)
    assert claim.source_approved_by is None

    link = complete_claim(db, target, claim, target_tree, target_member)

    assert link.status == IdentityLinkStatus.PROPOSED
    notifications = db.scalars(
        select(Notification).where(Notification.user_id == owner.id)
    ).all()
    assert any(n.type == "identity_link_proposed" for n in notifications)


def test_complete_is_not_repeatable(db):
    proposer, target, tree, target_tree, member = _friends_pair(db)
    target_member = add_member(db, target_tree, "mb", first_name="Ada")
    claim = propose_claim(db, proposer, tree, member, target.username)
    complete_claim(db, target, claim, target_tree, target_member)

    with pytest.raises(ConflictError):
        complete_claim(db, target, claim, target_tree, target_member)


def test_cancel_requires_the_proposer(db):
    proposer, target, tree, _target_tree, member = _friends_pair(db)
    claim = propose_claim(db, proposer, tree, member, target.username)

    with pytest.raises(AccessDeniedError):
        cancel_claim(db, target, claim)

    claim = cancel_claim(db, proposer, claim)
    assert claim.status == IdentityLinkClaimStatus.CANCELLED


def test_decline_requires_the_recipient(db):
    proposer, target, tree, _target_tree, member = _friends_pair(db)
    claim = propose_claim(db, proposer, tree, member, target.username)

    with pytest.raises(AccessDeniedError):
        decline_claim(db, proposer, claim)

    claim = decline_claim(db, target, claim, reason="not the same person")
    assert claim.status == IdentityLinkClaimStatus.DECLINED
    assert claim.decision_reason == "not the same person"


def test_decline_notifies_the_proposer(db):
    proposer, target, tree, _target_tree, member = _friends_pair(db)
    claim = propose_claim(db, proposer, tree, member, target.username)

    decline_claim(db, target, claim)

    notifications = db.scalars(
        select(Notification).where(Notification.user_id == proposer.id)
    ).all()
    assert any(n.type == "identity_link_claim_decided" for n in notifications)


def test_cancel_route_survives_losing_write_access_to_the_source_workspace(
    client, db
):
    owner = make_user(db, "dana-owner")
    editor = make_user(db, "carol")
    target = make_user(db, "bob")
    befriend(db, editor, target)
    tree = make_tree(db, owner)
    share(db, tree, editor, role="editor")
    member = add_member(db, tree, "ma", first_name="Ada")
    claim = propose_claim(db, editor, tree, member, target.username)

    from app.models import WorkspaceMembership

    db.query(WorkspaceMembership).filter_by(
        workspace_id=tree.id, user_id=editor.id
    ).delete()
    db.commit()

    resp = client.post(
        f"{API}/identity-link-claims/{claim.id}/cancel", headers=auth(editor)
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


def test_incoming_and_outgoing_listings(db):
    proposer, target, tree, _target_tree, member = _friends_pair(db)
    claim = propose_claim(db, proposer, tree, member, target.username)

    assert [c.id for c in list_incoming_claims(db, target)] == [claim.id]
    assert [c.id for c in list_outgoing_claims(db, proposer)] == [claim.id]
    assert list_incoming_claims(db, proposer) == []
    assert list_outgoing_claims(db, target) == []


def test_expire_stale_claims(db, monkeypatch):
    proposer, target, tree, _target_tree, member = _friends_pair(db)
    claim = propose_claim(db, proposer, tree, member, target.username)
    claim.expires_at = "2000-01-01T00:00:00+00:00"
    db.commit()

    count = expire_stale_claims(db)

    assert count == 1
    db.refresh(claim)
    assert claim.status == IdentityLinkClaimStatus.EXPIRED


def test_merge_repoints_a_pending_claim_onto_the_surviving_member(db):
    proposer, target, tree, _target_tree, member = _friends_pair(db)
    keep = add_member(db, tree, "keep", first_name="Keeper")
    claim = propose_claim(db, proposer, tree, member, target.username)

    merge_members_in_place(db, tree, keep, member, {})
    db.flush()

    db.refresh(claim)
    assert claim.source_member_id == keep.id
