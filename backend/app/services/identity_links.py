"""Identity link lifecycle: propose, approve, reject, revoke, expire.

Replaces the tree-in-tree bridge's implicit single-actor link with durable,
per-workspace consent — see ``app.models.identity_link`` for the shape and
invariants. A link is created unverified unless the proposer owns (or
administers) both workspaces at once (``verification_basis="same_owner"``);
otherwise each workspace's *owner* — not just any editor — must separately
approve before the link counts as verified. Approval is intentionally
owner-only (see #985): a manage_identity_links capability for non-owners is
left for a future issue.

Revocation is unilateral by design: either workspace's owner can sever a
link at any time without the other's consent, verified or not, because a
link never grants access or moves data — only the assertion of identity
itself is undone.

Every public function here that mutates the row does so behind SQLAlchemy's
``version_id_col`` optimistic check (see the model) and an optional
idempotency key, so a concurrent double-submit is safe: a stale read raises
``StaleDataError`` (mapped to 409 by the routes), and a retried call with the
same key replays the first call's result instead of re-executing.
"""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.core.config import settings
from app.core.exceptions import AccessDeniedError, ConflictError, InvalidInputError
from app.db.base import new_uuid, utcnow_iso
from app.models.family import Member
from app.models.identity_link import (
    IdentityLink,
    IdentityLinkAction,
    IdentityLinkBlock,
    IdentityLinkEvent,
    IdentityLinkIdempotencyKey,
    IdentityLinkStatus,
    IdentityLinkVerificationBasis,
)
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.identity_link import IdentityLinkEndpointOut, IdentityLinkOut
from app.schemas.notification import (
    IdentityLinkDecidedPayload,
    IdentityLinkProposedPayload,
)
from app.services.collaboration.notification_service import create_notification
from app.services.unit_of_work import UnitOfWork
from app.services.workspace_roles import role_for
from app.services.workspaces.visibility import resolve_access_context

logger = logging.getLogger(__name__)


def can_read_member(
    db: Session, workspace: Workspace, member_id: str, user: User
) -> bool:
    """True when ``user`` can read this specific member of ``workspace``.

    Goes through the #984 visibility resolver rather than a coarse
    workspace-level role check: a section-scoped grant that excludes this
    member, or a password-gated public link that was never unlocked, must
    not count as read access here even though the user has *some* standing
    in the workspace.
    """
    return resolve_access_context(db, workspace, user).can_read_member(db, member_id)


def is_blocked(db: Session, workspace_id: str, user_id: str) -> bool:
    return (
        db.scalar(
            select(IdentityLinkBlock.id).where(
                IdentityLinkBlock.workspace_id == workspace_id,
                IdentityLinkBlock.blocked_user_id == user_id,
            )
        )
        is not None
    )


def get_link_between(
    db: Session, member_x_id: str, member_y_id: str
) -> IdentityLink | None:
    a_id, b_id = sorted((member_x_id, member_y_id))
    return db.scalar(
        select(IdentityLink).where(
            IdentityLink.member_a_id == a_id, IdentityLink.member_b_id == b_id
        )
    )


# -- internal helpers --------------------------------------------------------


def _canonical_pair(member_x: Member, member_y: Member) -> tuple[Member, Member]:
    return (member_x, member_y) if member_x.id < member_y.id else (member_y, member_x)


def _expiry(now: str) -> str:
    dt = datetime.fromisoformat(now)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return (dt + timedelta(days=settings.IDENTITY_LINK_PROPOSAL_EXPIRY_DAYS)).isoformat()


def _past_expiry(link: IdentityLink) -> bool:
    return link.expires_at is not None and link.expires_at < utcnow_iso()


def _apply_verification_if_ready(link: IdentityLink, now: str) -> None:
    if link.approved_by_a is not None and link.approved_by_b is not None:
        link.status = IdentityLinkStatus.VERIFIED
        link.verified_at = now


def _record_event(
    db: Session,
    link: IdentityLink,
    action: str,
    actor_id: str | None,
    from_status: str | None,
    to_status: str,
    reason: str | None,
) -> None:
    db.add(
        IdentityLinkEvent(
            identity_link_id=link.id,
            action=action,
            actor_id=actor_id,
            from_status=from_status,
            to_status=to_status,
            reason=reason,
        )
    )


def _check_idempotency(
    db: Session, actor_id: str, action: str, key: str | None
) -> IdentityLink | None:
    if not key:
        return None
    row = db.get(IdentityLinkIdempotencyKey, (actor_id, action, key))
    return db.get(IdentityLink, row.identity_link_id) if row is not None else None


def _store_idempotency(
    db: Session, actor_id: str, action: str, key: str | None, link_id: str
) -> None:
    if not key:
        return
    db.add(
        IdentityLinkIdempotencyKey(
            actor_id=actor_id, action=action, key=key, identity_link_id=link_id
        )
    )


def _replay_or_raise(
    db: Session,
    actor_id: str,
    action: str,
    idempotency_key: str | None,
    message: str,
    exc: Exception,
) -> IdentityLink:
    """Called from an ``IntegrityError``/``StaleDataError`` handler after
    ``UnitOfWork`` has rolled back the failed attempt.

    Two requests carrying the same idempotency key can both miss
    ``_check_idempotency`` before either commits (neither's row exists yet),
    so the loser must not be told "conflict" for what is really a duplicate
    of the winner's own request — re-check here and replay the winner's
    result when the key matches.
    """
    replay = _check_idempotency(db, actor_id, action, idempotency_key)
    if replay is not None:
        return replay
    raise ConflictError(message) from exc


def _expire_single(db: Session, link: IdentityLink) -> None:
    from_status = link.status
    link.status = IdentityLinkStatus.EXPIRED
    link.decided_at = utcnow_iso()
    _record_event(
        db, link, IdentityLinkAction.EXPIRE, None, from_status, link.status, None
    )
    with UnitOfWork(db):
        pass


def _owner_sides(db: Session, link: IdentityLink, actor: User) -> tuple[bool, bool]:
    workspace_a = db.get(Workspace, link.workspace_a_id)
    workspace_b = db.get(Workspace, link.workspace_b_id)
    is_owner_a = actor.is_admin or (
        workspace_a is not None and role_for(db, workspace_a, actor) == "owner"
    )
    is_owner_b = actor.is_admin or (
        workspace_b is not None and role_for(db, workspace_b, actor) == "owner"
    )
    return is_owner_a, is_owner_b


def _apply_approval(db: Session, actor: User, link: IdentityLink) -> None:
    is_owner_a, is_owner_b = _owner_sides(db, link, actor)
    if not is_owner_a and not is_owner_b:
        raise AccessDeniedError("Only a workspace owner may approve an identity link")
    from_status = link.status
    now = utcnow_iso()
    if is_owner_a and link.approved_by_a is None:
        link.approved_by_a, link.approved_at_a = actor.id, now
    if is_owner_b and link.approved_by_b is None:
        link.approved_by_b, link.approved_at_b = actor.id, now
    _apply_verification_if_ready(link, now)
    _record_event(
        db, link, IdentityLinkAction.APPROVE, actor.id, from_status, link.status, None
    )


def _notify_pending_owners(
    db: Session,
    link: IdentityLink,
    actor: User,
    workspace_a: Workspace,
    workspace_b: Workspace,
) -> None:
    for approved_by, workspace in (
        (link.approved_by_a, workspace_a),
        (link.approved_by_b, workspace_b),
    ):
        if approved_by is not None or workspace.owner_id == actor.id:
            continue
        create_notification(
            db,
            workspace.owner_id,
            "identity_link_proposed",
            IdentityLinkProposedPayload(
                identity_link_id=link.id,
                workspace_id=workspace.id,
                workspace_name=workspace.name,
                proposer_username=actor.username,
            ),
        )


def _notify_decision(db: Session, link: IdentityLink, actor_id: str | None) -> None:
    for workspace_id in (link.workspace_a_id, link.workspace_b_id):
        workspace = db.get(Workspace, workspace_id)
        if workspace is None or workspace.owner_id == actor_id:
            continue
        create_notification(
            db,
            workspace.owner_id,
            "identity_link_decided",
            IdentityLinkDecidedPayload(
                identity_link_id=link.id,
                workspace_id=workspace.id,
                workspace_name=workspace.name,
                status=link.status,
            ),
        )


def _display_name(member: Member | None) -> str | None:
    if member is None:
        return None
    return " ".join(filter(None, [member.first_name, member.last_name])) or None


# -- public API ---------------------------------------------------------------


def propose_link(
    db: Session,
    actor: User,
    source_workspace: Workspace,
    source_member: Member,
    target_workspace: Workspace,
    target_member: Member,
    *,
    idempotency_key: str | None = None,
) -> IdentityLink:
    """Propose a link, or add the caller's own approval to one already pending.

    Errors are deliberately generic where a specific reason (target doesn't
    exist vs. no access vs. blocked) would let a caller enumerate another
    workspace's contents.
    """
    if existing := _check_idempotency(
        db, actor.id, IdentityLinkAction.PROPOSE, idempotency_key
    ):
        return existing

    if source_member.workspace_id == target_member.workspace_id:
        raise InvalidInputError(
            "A member cannot be linked to a member in its own workspace"
        )
    if target_member.workspace_id != target_workspace.id:
        raise InvalidInputError("Target member is not part of the target workspace")
    if not can_read_member(db, target_workspace, target_member.id, actor) or is_blocked(
        db, target_workspace.id, actor.id
    ):
        raise AccessDeniedError("Cannot propose a link to this member")

    try:
        link = get_link_between(db, source_member.id, target_member.id)

        if link is not None and link.status == IdentityLinkStatus.VERIFIED:
            raise ConflictError("Identity link already exists")

        if link is not None and link.status == IdentityLinkStatus.PROPOSED:
            _apply_approval(db, actor, link)
            with UnitOfWork(db) as uow:
                db.flush()
                _store_idempotency(
                    db, actor.id, IdentityLinkAction.PROPOSE, idempotency_key, link.id
                )
                if link.status == IdentityLinkStatus.VERIFIED:
                    uow.after_commit(lambda: _notify_decision(db, link, actor.id))
            db.refresh(link)
            return link

        ws_by_member = {
            source_member.id: source_workspace,
            target_member.id: target_workspace,
        }
        member_a, member_b = _canonical_pair(source_member, target_member)
        workspace_a, workspace_b = ws_by_member[member_a.id], ws_by_member[member_b.id]

        is_owner_a = actor.is_admin or role_for(db, workspace_a, actor) == "owner"
        is_owner_b = actor.is_admin or role_for(db, workspace_b, actor) == "owner"
        basis = (
            IdentityLinkVerificationBasis.SAME_OWNER
            if is_owner_a and is_owner_b
            else IdentityLinkVerificationBasis.MUTUAL_CONSENT
        )

        now = utcnow_iso()
        from_status = link.status if link is not None else None
        if link is None:
            link = IdentityLink(
                id=new_uuid(),
                member_a_id=member_a.id,
                member_b_id=member_b.id,
                workspace_a_id=workspace_a.id,
                workspace_b_id=workspace_b.id,
                verification_basis=basis,
            )
        else:
            # Reopen a rejected/expired/revoked pair, mirroring how a
            # declined friend request reopens on a fresh send_request.
            link.verification_basis = basis
            link.approved_by_a = link.approved_at_a = None
            link.approved_by_b = link.approved_at_b = None
            link.verified_at = None
            link.decided_by = link.decided_at = link.decision_reason = None

        link.status = IdentityLinkStatus.PROPOSED
        link.proposed_by = actor.id
        link.proposed_at = now
        link.expires_at = _expiry(now)
        if is_owner_a:
            link.approved_by_a, link.approved_at_a = actor.id, now
        if is_owner_b:
            link.approved_by_b, link.approved_at_b = actor.id, now
        _apply_verification_if_ready(link, now)

        with UnitOfWork(db) as uow:
            db.add(link)
            db.flush()
            _record_event(
                db,
                link,
                IdentityLinkAction.PROPOSE,
                actor.id,
                from_status,
                link.status,
                None,
            )
            _store_idempotency(
                db, actor.id, IdentityLinkAction.PROPOSE, idempotency_key, link.id
            )
            # Nothing to notify for an immediately-verified same_owner link —
            # the proposer already owns both sides.
            if link.status != IdentityLinkStatus.VERIFIED:
                uow.after_commit(
                    lambda: _notify_pending_owners(
                        db, link, actor, workspace_a, workspace_b
                    )
                )
        db.refresh(link)
        return link
    except IntegrityError as exc:
        return _replay_or_raise(
            db,
            actor.id,
            IdentityLinkAction.PROPOSE,
            idempotency_key,
            "Identity link already exists",
            exc,
        )
    except StaleDataError as exc:
        return _replay_or_raise(
            db,
            actor.id,
            IdentityLinkAction.PROPOSE,
            idempotency_key,
            "Identity link changed concurrently; reload and retry",
            exc,
        )


def approve_link(
    db: Session, actor: User, link: IdentityLink, *, idempotency_key: str | None = None
) -> IdentityLink:
    if existing := _check_idempotency(
        db, actor.id, IdentityLinkAction.APPROVE, idempotency_key
    ):
        return existing
    if link.status != IdentityLinkStatus.PROPOSED:
        raise ConflictError("Identity link is not awaiting approval")
    if _past_expiry(link):
        _expire_single(db, link)
        raise ConflictError("Identity link proposal has expired")

    _apply_approval(db, actor, link)
    try:
        with UnitOfWork(db) as uow:
            db.flush()
            _store_idempotency(
                db, actor.id, IdentityLinkAction.APPROVE, idempotency_key, link.id
            )
            if link.status == IdentityLinkStatus.VERIFIED:
                uow.after_commit(lambda: _notify_decision(db, link, actor.id))
    except StaleDataError as exc:
        return _replay_or_raise(
            db,
            actor.id,
            IdentityLinkAction.APPROVE,
            idempotency_key,
            "Identity link changed concurrently; reload and retry",
            exc,
        )
    db.refresh(link)
    return link


def reject_link(
    db: Session,
    actor: User,
    link: IdentityLink,
    *,
    reason: str | None = None,
    block_proposer: bool = False,
    idempotency_key: str | None = None,
) -> IdentityLink:
    if existing := _check_idempotency(
        db, actor.id, IdentityLinkAction.REJECT, idempotency_key
    ):
        return existing
    if link.status != IdentityLinkStatus.PROPOSED:
        raise ConflictError("Identity link is not awaiting approval")
    if _past_expiry(link):
        _expire_single(db, link)
        raise ConflictError("Identity link proposal has expired")

    is_owner_a, is_owner_b = _owner_sides(db, link, actor)
    if not is_owner_a and not is_owner_b:
        raise AccessDeniedError("Only a workspace owner may reject an identity link")

    from_status = link.status
    link.status = IdentityLinkStatus.REJECTED
    link.decided_by = actor.id
    link.decided_at = utcnow_iso()
    link.decision_reason = reason
    _record_event(
        db, link, IdentityLinkAction.REJECT, actor.id, from_status, link.status, reason
    )

    if block_proposer and link.proposed_by and link.proposed_by != actor.id:
        rejecting_workspace_id = (
            link.workspace_a_id if is_owner_a else link.workspace_b_id
        )
        if not is_blocked(db, rejecting_workspace_id, link.proposed_by):
            db.add(
                IdentityLinkBlock(
                    workspace_id=rejecting_workspace_id,
                    blocked_user_id=link.proposed_by,
                    created_by=actor.id,
                )
            )

    try:
        with UnitOfWork(db) as uow:
            db.flush()
            _store_idempotency(
                db, actor.id, IdentityLinkAction.REJECT, idempotency_key, link.id
            )
            uow.after_commit(lambda: _notify_decision(db, link, actor.id))
    except StaleDataError as exc:
        return _replay_or_raise(
            db,
            actor.id,
            IdentityLinkAction.REJECT,
            idempotency_key,
            "Identity link changed concurrently; reload and retry",
            exc,
        )
    db.refresh(link)
    return link


def revoke_link(
    db: Session,
    actor: User,
    link: IdentityLink,
    *,
    reason: str | None = None,
    idempotency_key: str | None = None,
) -> IdentityLink:
    """Unilaterally sever a proposed or verified link.

    Either workspace's owner may revoke without the other's consent — a link
    never grants access, so unwinding it is always a local decision (#985).
    """
    if existing := _check_idempotency(
        db, actor.id, IdentityLinkAction.REVOKE, idempotency_key
    ):
        return existing
    if link.status not in (IdentityLinkStatus.VERIFIED, IdentityLinkStatus.PROPOSED):
        raise ConflictError("Identity link cannot be revoked from its current state")

    is_owner_a, is_owner_b = _owner_sides(db, link, actor)
    if not is_owner_a and not is_owner_b:
        raise AccessDeniedError("Only a workspace owner may revoke an identity link")

    from_status = link.status
    link.status = IdentityLinkStatus.REVOKED
    link.decided_by = actor.id
    link.decided_at = utcnow_iso()
    link.decision_reason = reason
    _record_event(
        db, link, IdentityLinkAction.REVOKE, actor.id, from_status, link.status, reason
    )

    try:
        with UnitOfWork(db) as uow:
            db.flush()
            _store_idempotency(
                db, actor.id, IdentityLinkAction.REVOKE, idempotency_key, link.id
            )
            uow.after_commit(lambda: _notify_decision(db, link, actor.id))
    except StaleDataError as exc:
        return _replay_or_raise(
            db,
            actor.id,
            IdentityLinkAction.REVOKE,
            idempotency_key,
            "Identity link changed concurrently; reload and retry",
            exc,
        )
    db.refresh(link)
    return link


def expire_stale_proposals(db: Session) -> int:
    """Transition every proposal past its ``expires_at`` to expired.

    Called from the deletion-sweep background loop
    (``app.services.system.deletion_sweeper``); returns the count for logging.
    """
    now = utcnow_iso()
    stale = list(
        db.scalars(
            select(IdentityLink).where(
                IdentityLink.status == IdentityLinkStatus.PROPOSED,
                IdentityLink.expires_at.is_not(None),
                IdentityLink.expires_at < now,
            )
        )
    )
    for link in stale:
        from_status = link.status
        link.status = IdentityLinkStatus.EXPIRED
        link.decided_at = now
        _record_event(
            db, link, IdentityLinkAction.EXPIRE, None, from_status, link.status, None
        )
    if stale:
        with UnitOfWork(db):
            pass
    return len(stale)


def list_links_for_member(
    db: Session, viewer: User, member: Member
) -> list[IdentityLinkOut]:
    rows = db.scalars(
        select(IdentityLink).where(
            or_(
                IdentityLink.member_a_id == member.id,
                IdentityLink.member_b_id == member.id,
            )
        )
    ).all()
    return [to_identity_link_out(db, link, viewer, member) for link in rows]


def list_links_for_workspace(
    db: Session, viewer: User, workspace: Workspace
) -> list[IdentityLinkOut]:
    """Every link touching ``workspace``, for its owner to review (#1014).

    Unlike ``list_links_for_member``, this isn't scoped to read access on any
    particular member — the caller is expected to already be that workspace's
    owner (enforced by the route), so every link naming one of their own
    members is fair game to review regardless of section-scoped visibility.
    """
    rows = db.scalars(
        select(IdentityLink)
        .where(
            or_(
                IdentityLink.workspace_a_id == workspace.id,
                IdentityLink.workspace_b_id == workspace.id,
            )
        )
        .order_by(IdentityLink.proposed_at.desc())
    ).all()
    out = []
    for link in rows:
        is_a = link.workspace_a_id == workspace.id
        member = db.get(Member, link.member_a_id if is_a else link.member_b_id)
        if member is None:
            continue
        out.append(to_identity_link_out(db, link, viewer, member))
    return out


def to_identity_link_out(
    db: Session, link: IdentityLink, viewer: User, member: Member
) -> IdentityLinkOut:
    is_a = link.member_a_id == member.id
    self_workspace_id = link.workspace_a_id if is_a else link.workspace_b_id
    other_member_id = link.member_b_id if is_a else link.member_a_id
    other_workspace_id = link.workspace_b_id if is_a else link.workspace_a_id

    self_workspace = db.get(Workspace, self_workspace_id)
    self_out = IdentityLinkEndpointOut(
        workspace_id=self_workspace_id,
        workspace_name=self_workspace.name if self_workspace else "",
        member_id=member.id,
        display_name=_display_name(member),
    )

    other_workspace = db.get(Workspace, other_workspace_id)
    # Losing read access to the counterpart *member* — whole-workspace access
    # revoked, narrowed to a section that excludes them, or an unlocked
    # public link losing its unlock — degrades it to a protected placeholder.
    # The link row itself is untouched (#985).
    protected = other_workspace is None or not can_read_member(
        db, other_workspace, other_member_id, viewer
    )
    counterpart_out = None
    if not protected:
        other_member = db.get(Member, other_member_id)
        counterpart_out = IdentityLinkEndpointOut(
            workspace_id=other_workspace_id,
            workspace_name=other_workspace.name,
            member_id=other_member_id,
            display_name=_display_name(other_member),
        )

    return IdentityLinkOut(
        id=link.id,
        status=link.status,
        verification_basis=link.verification_basis,
        self=self_out,
        counterpart=counterpart_out,
        counterpart_protected=protected,
        proposed_at=link.proposed_at,
        expires_at=link.expires_at,
        verified_at=link.verified_at,
        decided_at=link.decided_at,
        decision_reason=link.decision_reason,
    )


def repoint_identity_links_for_merge(db: Session, keep: Member, remove: Member) -> None:
    """Carry ``remove``'s identity links onto ``keep``.

    Called from ``member_merge.merge_members_in_place`` before ``remove`` is
    deleted, mirroring its ``_repoint_member_links`` helper. A link to a
    counterpart ``keep`` already links to would become a duplicate pair, so
    that one is dropped instead of repointed — ``keep``'s existing link
    already carries that fact, and dropping it never fabricates a new
    verification.
    """
    rows = db.scalars(
        select(IdentityLink).where(
            or_(
                IdentityLink.member_a_id == remove.id,
                IdentityLink.member_b_id == remove.id,
            )
        )
    ).all()
    for link in rows:
        is_a = link.member_a_id == remove.id
        counterpart_id = link.member_b_id if is_a else link.member_a_id
        if get_link_between(db, keep.id, counterpart_id) is not None:
            db.delete(link)
            continue
        if is_a:
            link.member_a_id, link.workspace_a_id = keep.id, keep.workspace_id
        else:
            link.member_b_id, link.workspace_b_id = keep.id, keep.workspace_id
        _reorder_canonical(link)
    db.flush()


def _reorder_canonical(link: IdentityLink) -> None:
    """Restore ``member_a_id < member_b_id`` after an endpoint is repointed,
    swapping each side's bookkeeping along with it so it still describes the
    same workspace/approval it did before the reorder."""
    if link.member_a_id < link.member_b_id:
        return
    link.member_a_id, link.member_b_id = link.member_b_id, link.member_a_id
    link.workspace_a_id, link.workspace_b_id = link.workspace_b_id, link.workspace_a_id
    link.approved_by_a, link.approved_by_b = link.approved_by_b, link.approved_by_a
    link.approved_at_a, link.approved_at_b = link.approved_at_b, link.approved_at_a
