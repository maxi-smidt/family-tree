"""Tests for the identity-link lifecycle (#985) — see app.services.identity_links."""

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.core.exceptions import AccessDeniedError, ConflictError, InvalidInputError
from app.models import Section, SectionMember, WorkspaceSectionGrant
from app.models.identity_link import (
    IdentityLinkEvent,
    IdentityLinkStatus,
    IdentityLinkVerificationBasis,
)
from app.schemas.identity_link import DecideIdentityLinkRequest
from app.services.identity_links import (
    approve_link,
    can_read_member,
    expire_stale_proposals,
    get_link_between,
    is_blocked,
    list_links_for_member,
    propose_link,
    reject_link,
    repoint_identity_links_for_merge,
    revoke_link,
)
from app.services.members.member_merge import merge_members_in_place
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def test_decision_reason_is_bounded_to_the_database_column():
    """IdentityLink.decision_reason is String(500); an over-length value must
    be rejected as a validation error here, not surfaced as a DB write
    failure once it reaches the service."""
    DecideIdentityLinkRequest(reason="x" * 500)  # must not raise
    with pytest.raises(ValidationError):
        DecideIdentityLinkRequest(reason="x" * 501)


def _cross_owner_pair(db):
    """Two members in two workspaces owned by two different users.

    ``tree_b`` is shared with ``owner_a`` as a viewer — proposing a link
    requires having found the target member in the first place, which in
    turn requires read access to their workspace.
    """
    owner_a = make_user(db, "alice")
    owner_b = make_user(db, "bob")
    tree_a = make_tree(db, owner_a, "A")
    tree_b = make_tree(db, owner_b, "B")
    share(db, tree_b, owner_a, role="viewer")
    member_a = add_member(db, tree_a, "ma", first_name="Ada")
    member_b = add_member(db, tree_b, "mb", first_name="Ada")
    return owner_a, owner_b, tree_a, tree_b, member_a, member_b


# --- propose / verification basis -------------------------------------------


def test_propose_same_owner_auto_verifies(db):
    owner = make_user(db, "alice")
    tree_a = make_tree(db, owner, "A")
    tree_b = make_tree(db, owner, "B")
    member_a = add_member(db, tree_a, "ma", first_name="Ada")
    member_b = add_member(db, tree_b, "mb", first_name="Ada")

    link = propose_link(db, owner, tree_a, member_a, tree_b, member_b)

    assert link.status == IdentityLinkStatus.VERIFIED
    assert link.verification_basis == IdentityLinkVerificationBasis.SAME_OWNER
    assert link.approved_by_a == owner.id
    assert link.approved_by_b == owner.id


def test_propose_cross_owner_waits_for_the_other_owner(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)

    link = propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)
    assert link.status == IdentityLinkStatus.PROPOSED
    assert link.verification_basis == IdentityLinkVerificationBasis.MUTUAL_CONSENT
    assert link.approved_by_a is not None or link.approved_by_b is not None

    link = approve_link(db, owner_b, link)
    assert link.status == IdentityLinkStatus.VERIFIED
    assert link.approved_by_a is not None
    assert link.approved_by_b is not None


def test_editor_proposing_does_not_auto_approve_either_side(db):
    """Approval is owner-only — an editor's own write access never counts as
    consent, even on their own workspace side."""
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    editor = make_user(db, "carol")
    share(db, tree_a, editor, role="editor")
    share(db, tree_b, editor, role="viewer")

    link = propose_link(db, editor, tree_a, member_a, tree_b, member_b)
    assert link.status == IdentityLinkStatus.PROPOSED
    assert link.approved_by_a is None
    assert link.approved_by_b is None

    with pytest.raises(AccessDeniedError):
        approve_link(db, editor, link)

    link = approve_link(db, owner_a, link)
    assert link.status == IdentityLinkStatus.PROPOSED
    link = approve_link(db, owner_b, link)
    assert link.status == IdentityLinkStatus.VERIFIED


def test_propose_rejects_same_workspace_members(db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    member_a = add_member(db, tree, "ma", first_name="Ada")
    member_b = add_member(db, tree, "mb", first_name="Eve")
    with pytest.raises(InvalidInputError):
        propose_link(db, owner, tree, member_a, tree, member_b)


def test_propose_is_canonically_ordered_regardless_of_call_direction(db):
    owner = make_user(db, "alice")
    tree_a = make_tree(db, owner, "A")
    tree_b = make_tree(db, owner, "B")
    member_a = add_member(db, tree_a, "ma", first_name="Ada")
    member_b = add_member(db, tree_b, "mb", first_name="Ada")

    link = propose_link(db, owner, tree_b, member_b, tree_a, member_a)
    assert (link.member_a_id, link.member_b_id) == tuple(sorted(["ma", "mb"]))
    assert get_link_between(db, "ma", "mb") is link
    assert get_link_between(db, "mb", "ma") is link


def test_propose_on_an_already_verified_pair_conflicts(db):
    owner = make_user(db, "alice")
    tree_a = make_tree(db, owner, "A")
    tree_b = make_tree(db, owner, "B")
    member_a = add_member(db, tree_a, "ma", first_name="Ada")
    member_b = add_member(db, tree_b, "mb", first_name="Ada")
    propose_link(db, owner, tree_a, member_a, tree_b, member_b)

    with pytest.raises(ConflictError):
        propose_link(db, owner, tree_a, member_a, tree_b, member_b)


# --- reject / block ----------------------------------------------------------


def test_reject_requires_a_workspace_owner(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    outsider = make_user(db, "mallory")
    link = propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)
    with pytest.raises(AccessDeniedError):
        reject_link(db, outsider, link)


def test_reject_then_block_prevents_further_proposals(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    link = propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)

    link = reject_link(
        db, owner_b, link, reason="not the same person", block_proposer=True
    )
    assert link.status == IdentityLinkStatus.REJECTED
    assert is_blocked(db, tree_b.id, owner_a.id)

    with pytest.raises(AccessDeniedError):
        propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)


def test_reject_reopens_on_a_fresh_propose(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    link = propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)
    reject_link(db, owner_b, link, reason="nope")

    link = propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)
    assert link.status == IdentityLinkStatus.PROPOSED
    assert link.decision_reason is None
    assert link.decided_at is None

    # The reopen's audit event records where it came from, not a fabricated
    # "initial creation" (from_status=None would be indistinguishable from a
    # brand-new proposal).
    events = db.scalars(
        select(IdentityLinkEvent)
        .where(IdentityLinkEvent.identity_link_id == link.id)
        .order_by(IdentityLinkEvent.created_at)
    ).all()
    assert [e.action for e in events] == ["propose", "reject", "propose"]
    assert events[-1].from_status == IdentityLinkStatus.REJECTED
    assert events[-1].to_status == IdentityLinkStatus.PROPOSED


# --- revoke -------------------------------------------------------------------


def test_revoke_is_unilateral(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    link = propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)
    approve_link(db, owner_b, link)
    assert link.status == IdentityLinkStatus.VERIFIED

    link = revoke_link(db, owner_a, link, reason="mistake")
    assert link.status == IdentityLinkStatus.REVOKED
    assert link.decided_by == owner_a.id


def test_revoke_requires_a_workspace_owner(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    link = propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)
    approve_link(db, owner_b, link)
    outsider = make_user(db, "mallory")
    with pytest.raises(AccessDeniedError):
        revoke_link(db, outsider, link)


# --- idempotency ---------------------------------------------------------------


def test_propose_idempotency_key_replays_the_first_result(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    first = propose_link(
        db, owner_a, tree_a, member_a, tree_b, member_b, idempotency_key="req-1"
    )
    second = propose_link(
        db, owner_a, tree_a, member_a, tree_b, member_b, idempotency_key="req-1"
    )
    assert first.id == second.id
    # The replayed call re-executed nothing: still exactly one propose event.
    events = db.scalars(
        select(IdentityLinkEvent).where(IdentityLinkEvent.identity_link_id == first.id)
    ).all()
    assert len(events) == 1


def test_idempotency_conflict_replays_the_winner_instead_of_raising(db):
    """Simulates the race where two requests with the same key both miss the
    pre-check (neither's row exists yet): once the winner's idempotency row
    has landed, a losing IntegrityError/StaleDataError must replay it rather
    than surface a spurious 409 to the loser."""
    from app.services.identity_links import _replay_or_raise  # noqa: PLC0415

    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    winner = propose_link(
        db, owner_a, tree_a, member_a, tree_b, member_b, idempotency_key="req-1"
    )

    replayed = _replay_or_raise(
        db, owner_a.id, "propose", "req-1", "Identity link already exists", ValueError()
    )
    assert replayed.id == winner.id

    # No matching idempotency row: the loser really did lose, so it raises.
    with pytest.raises(ConflictError):
        _replay_or_raise(
            db, owner_a.id, "propose", "req-nonexistent", "conflict", ValueError()
        )


# --- expiry --------------------------------------------------------------------


def test_concurrent_reject_and_revoke_conflict_via_optimistic_locking(session_factory):
    """Two overlapping sessions racing on the same row: the second writer to
    flush must see a 409, not silently clobber the first writer's decision."""
    db1 = session_factory()
    db2 = session_factory()
    try:
        owner_a = make_user(db1, "alice")
        owner_b = make_user(db1, "bob")
        tree_a = make_tree(db1, owner_a, "A")
        tree_b = make_tree(db1, owner_b, "B")
        share(db1, tree_b, owner_a, role="viewer")
        member_a = add_member(db1, tree_a, "ma", first_name="Ada")
        member_b = add_member(db1, tree_b, "mb", first_name="Ada")
        link = propose_link(db1, owner_a, tree_a, member_a, tree_b, member_b)
        approve_link(db1, owner_b, link)  # verified

        # Two independent sessions load the same verified row...
        link1 = db1.get(type(link), link.id)
        link2 = db2.get(type(link), link.id)
        owner_b_db2 = db2.get(type(owner_b), owner_b.id)

        # ...db1 revokes and commits first...
        revoke_link(db1, owner_a, link1, reason="mistake")

        # ...db2's stale in-memory copy conflicts on write.
        with pytest.raises(ConflictError):
            revoke_link(db2, owner_b_db2, link2, reason="also mistake")
    finally:
        db1.close()
        db2.close()


def test_expire_stale_proposals_transitions_past_expiry_rows(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    link = propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)
    link.expires_at = "2000-01-01T00:00:00+00:00"
    db.commit()

    count = expire_stale_proposals(db)
    assert count == 1
    db.refresh(link)
    assert link.status == IdentityLinkStatus.EXPIRED


# --- read-side placeholder degradation -----------------------------------------


def test_counterpart_is_a_protected_placeholder_without_read_access(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)  # not verified yet

    outsider = make_user(db, "mallory")
    share(db, tree_a, outsider, role="viewer")

    [out] = list_links_for_member(db, outsider, member_a)
    assert out.counterpart_protected is True
    assert out.counterpart is None
    assert out.self.member_id == member_a.id


def test_section_scoped_grant_excluding_the_member_still_degrades_to_protected(db):
    """A section-scoped grant is not a workspace-wide role: a viewer scoped to
    a section that doesn't contain the counterpart must not see them, even
    though a coarse role_for(...) check on the workspace would say "viewer"."""
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)

    other_section = Section(workspace_id=tree_b.id, name="Elsewhere")
    db.add(other_section)
    db.commit()
    scoped_viewer = make_user(db, "dana")
    db.add(
        WorkspaceSectionGrant(
            workspace_id=tree_b.id,
            section_id=other_section.id,
            user_id=scoped_viewer.id,
            role="viewer",
        )
    )
    db.commit()

    assert can_read_member(db, tree_b, member_b.id, scoped_viewer) is False

    [out] = list_links_for_member(db, scoped_viewer, member_a)
    assert out.counterpart_protected is True
    assert out.counterpart is None


def test_section_scoped_grant_including_the_member_can_read_it(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)

    section = Section(workspace_id=tree_b.id, name="Home")
    db.add(section)
    db.commit()
    db.add(SectionMember(section_id=section.id, member_id=member_b.id))
    scoped_viewer = make_user(db, "dana")
    db.add(
        WorkspaceSectionGrant(
            workspace_id=tree_b.id,
            section_id=section.id,
            user_id=scoped_viewer.id,
            role="viewer",
        )
    )
    db.commit()

    assert can_read_member(db, tree_b, member_b.id, scoped_viewer) is True


def test_counterpart_is_visible_with_read_access(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)

    [out] = list_links_for_member(db, owner_b, member_a)
    assert out.counterpart_protected is False
    assert out.counterpart is not None
    assert out.counterpart.member_id == member_b.id


# --- member merge repoint --------------------------------------------------------


def test_merge_repoints_identity_link_onto_the_surviving_member(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    other = add_member(db, tree_a, "keep", first_name="Ada", last_name="K")
    propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)

    keep, *_ = merge_members_in_place(db, tree_a, other, member_a, {})
    db.flush()

    link = get_link_between(db, "keep", "mb")
    assert link is not None
    assert link.member_a_id in ("keep", "mb")


def test_merge_drops_the_duplicate_link_when_keep_already_has_one(db):
    owner_a, owner_b, tree_a, tree_b, member_a, member_b = _cross_owner_pair(db)
    other = add_member(db, tree_a, "keep", first_name="Ada", last_name="K")
    propose_link(db, owner_a, tree_a, member_a, tree_b, member_b)
    propose_link(db, owner_a, tree_a, other, tree_b, member_b)

    repoint_identity_links_for_merge(db, other, member_a)

    # Only "keep"'s own pre-existing link to member_b survives.
    assert get_link_between(db, "keep", "mb") is not None
    assert get_link_between(db, "ma", "mb") is None


# --- route-level non-enumeration -----------------------------------------------


def test_propose_route_gives_identical_responses_for_missing_and_hidden_targets(
    client, db
):
    """A caller must not be able to tell "no such member" apart from "that
    member exists but you can't see it" — both are the proposer's target
    validation failing, not a lookup they're entitled to an answer on."""
    owner_a = make_user(db, "alice")
    owner_b = make_user(db, "bob")
    tree_a = make_tree(db, owner_a, "A")
    tree_b = make_tree(db, owner_b, "B")  # not shared with owner_a
    add_member(db, tree_a, "ma", first_name="Ada")
    add_member(db, tree_b, "mb", first_name="Ada")
    headers = auth(owner_a)

    resp_missing = client.post(
        f"{API}/workspaces/{tree_a.id}/members/ma/identity-links",
        json={"target_workspace_id": tree_b.id, "target_member_id": "does-not-exist"},
        headers=headers,
    )
    resp_hidden = client.post(
        f"{API}/workspaces/{tree_a.id}/members/ma/identity-links",
        json={"target_workspace_id": tree_b.id, "target_member_id": "mb"},
        headers=headers,
    )

    assert resp_missing.status_code == resp_hidden.status_code == 403
    assert resp_missing.json() == resp_hidden.json()
