"""Identity link claims: the opaque half of #1014's proposal flow.

See ``app.models.identity_link_claim`` for why this exists. A claim never
lets the proposer read or enumerate anything in the target's workspace: it
names only the proposer's own member and the target *user* (who must already
be an accepted friend — the same boundary workspace sharing with a
registered user is gated on). The target later completes it by picking one
of their own members, at which point it becomes a normal ``IdentityLink``
indistinguishable from a direct proposal.

Reuses ``app.services.identity_links``' private helpers for the parts of
link-creation this shares with a direct proposal, rather than duplicating or
refactoring that already-tested lifecycle code.
"""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.core.config import settings
from app.core.exceptions import AccessDeniedError, ConflictError, InvalidInputError
from app.db.base import new_uuid, utcnow_iso
from app.models.family import Member
from app.models.identity_link import (
    IdentityLink,
    IdentityLinkAction,
    IdentityLinkStatus,
    IdentityLinkVerificationBasis,
)
from app.models.identity_link_claim import IdentityLinkClaim, IdentityLinkClaimStatus
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.identity_link import IdentityLinkClaimOut
from app.schemas.notification import (
    IdentityLinkClaimDecidedPayload,
    IdentityLinkClaimReceivedPayload,
)
from app.services.collaboration.friendships import are_friends
from app.services.collaboration.notification_service import create_notification
from app.services.identity_links import (
    _apply_verification_if_ready,
    _canonical_pair,
    _display_name,
    _notify_decision,
    _record_event,
    get_link_between,
)
from app.services.unit_of_work import UnitOfWork
from app.services.workspace_roles import role_for

logger = logging.getLogger(__name__)


def _expiry(now: str) -> str:
    dt = datetime.fromisoformat(now)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return (dt + timedelta(days=settings.IDENTITY_LINK_PROPOSAL_EXPIRY_DAYS)).isoformat()


def _past_expiry(claim: IdentityLinkClaim) -> bool:
    return claim.expires_at is not None and claim.expires_at < utcnow_iso()


def _expire_single(db: Session, claim: IdentityLinkClaim) -> None:
    claim.status = IdentityLinkClaimStatus.EXPIRED
    claim.decided_at = utcnow_iso()
    with UnitOfWork(db):
        pass


def to_claim_out(db: Session, claim: IdentityLinkClaim) -> IdentityLinkClaimOut:
    member = db.get(Member, claim.source_member_id)
    workspace = db.get(Workspace, member.workspace_id) if member else None
    target_user = db.get(User, claim.target_user_id)
    proposer = db.get(User, claim.proposed_by) if claim.proposed_by else None
    return IdentityLinkClaimOut(
        id=claim.id,
        status=claim.status,
        source_workspace_id=member.workspace_id if member else "",
        source_workspace_name=workspace.name if workspace else "",
        source_member_id=claim.source_member_id,
        source_display_name=_display_name(member),
        proposer_username=proposer.username if proposer else None,
        target_username=target_user.username if target_user else "",
        note=claim.note,
        created_at=claim.created_at,
        expires_at=claim.expires_at,
        decided_at=claim.decided_at,
        decision_reason=claim.decision_reason,
        resulting_identity_link_id=claim.resulting_identity_link_id,
    )


def propose_claim(
    db: Session,
    actor: User,
    source_workspace: Workspace,
    source_member: Member,
    target_username: str,
    *,
    note: str | None = None,
) -> IdentityLinkClaim:
    """Propose a claim to an accepted friend, or refresh one already pending.

    The error for "no such user" and "not an accepted friend" is identical —
    a claim must never let a caller enumerate other users' friend lists.
    """
    target_user = db.scalar(
        select(User).where(
            func.lower(User.username) == target_username.strip().lower(),
            User.is_active.is_(True),
            User.deletion_requested_at.is_(None),
        )
    )
    if (
        target_user is None
        or target_user.id == actor.id
        or not are_friends(db, actor.id, target_user.id)
    ):
        raise AccessDeniedError("Cannot propose an identity link claim to this user")

    existing = db.scalar(
        select(IdentityLinkClaim).where(
            IdentityLinkClaim.source_member_id == source_member.id,
            IdentityLinkClaim.target_user_id == target_user.id,
            IdentityLinkClaim.status == IdentityLinkClaimStatus.PENDING,
        )
    )
    now = utcnow_iso()
    is_owner = actor.is_admin or role_for(db, source_workspace, actor) == "owner"

    if existing is not None:
        existing.note = note
        existing.expires_at = _expiry(now)
        with UnitOfWork(db):
            pass
        db.refresh(existing)
        return existing

    claim = IdentityLinkClaim(
        id=new_uuid(),
        source_member_id=source_member.id,
        proposed_by=actor.id,
        source_approved_by=actor.id if is_owner else None,
        source_approved_at=now if is_owner else None,
        target_user_id=target_user.id,
        note=note,
        status=IdentityLinkClaimStatus.PENDING,
        created_at=now,
        expires_at=_expiry(now),
    )

    with UnitOfWork(db) as uow:
        db.add(claim)
        db.flush()
        uow.after_commit(
            lambda: create_notification(
                db,
                target_user.id,
                "identity_link_claim_received",
                IdentityLinkClaimReceivedPayload(
                    identity_link_claim_id=claim.id,
                    proposer_username=actor.username,
                    source_display_name=_display_name(source_member),
                ),
            )
        )
    db.refresh(claim)
    return claim


def list_outgoing_claims(db: Session, actor: User) -> list[IdentityLinkClaim]:
    return list(
        db.scalars(
            select(IdentityLinkClaim)
            .where(IdentityLinkClaim.proposed_by == actor.id)
            .order_by(IdentityLinkClaim.created_at.desc())
        ).all()
    )


def list_incoming_claims(db: Session, actor: User) -> list[IdentityLinkClaim]:
    return list(
        db.scalars(
            select(IdentityLinkClaim)
            .where(
                IdentityLinkClaim.target_user_id == actor.id,
                IdentityLinkClaim.status == IdentityLinkClaimStatus.PENDING,
            )
            .order_by(IdentityLinkClaim.created_at.desc())
        ).all()
    )


def list_claims_for_member(db: Session, member: Member) -> list[IdentityLinkClaim]:
    return list(
        db.scalars(
            select(IdentityLinkClaim)
            .where(IdentityLinkClaim.source_member_id == member.id)
            .order_by(IdentityLinkClaim.created_at.desc())
        ).all()
    )


def cancel_claim(db: Session, actor: User, claim: IdentityLinkClaim) -> IdentityLinkClaim:
    if claim.status != IdentityLinkClaimStatus.PENDING:
        raise ConflictError("Identity link claim is not pending")
    if claim.proposed_by != actor.id and not actor.is_admin:
        raise AccessDeniedError("Only the proposer may cancel an identity link claim")

    claim.status = IdentityLinkClaimStatus.CANCELLED
    claim.decided_by = actor.id
    claim.decided_at = utcnow_iso()
    try:
        with UnitOfWork(db):
            pass
    except StaleDataError as exc:
        raise ConflictError(
            "Identity link claim changed concurrently; reload and retry"
        ) from exc
    db.refresh(claim)
    return claim


def decline_claim(
    db: Session, actor: User, claim: IdentityLinkClaim, *, reason: str | None = None
) -> IdentityLinkClaim:
    if claim.target_user_id != actor.id:
        raise AccessDeniedError("Only the recipient may decline an identity link claim")
    if claim.status != IdentityLinkClaimStatus.PENDING:
        raise ConflictError("Identity link claim is not pending")
    if _past_expiry(claim):
        _expire_single(db, claim)
        raise ConflictError("Identity link claim has expired")

    claim.status = IdentityLinkClaimStatus.DECLINED
    claim.decided_by = actor.id
    claim.decided_at = utcnow_iso()
    claim.decision_reason = reason
    try:
        with UnitOfWork(db):
            pass
    except StaleDataError as exc:
        raise ConflictError(
            "Identity link claim changed concurrently; reload and retry"
        ) from exc
    db.refresh(claim)
    return claim


def complete_claim(
    db: Session,
    actor: User,
    claim: IdentityLinkClaim,
    target_workspace: Workspace,
    target_member: Member,
) -> IdentityLink:
    """Resolve a pending claim by the target owner naming their own member.

    Produces the same ``IdentityLink`` a direct mutual-consent proposal
    would, carrying over the source side's approval captured at claim
    creation and recording the completing owner's pick as their own.
    """
    if claim.target_user_id != actor.id:
        raise AccessDeniedError(
            "Only the recipient may complete an identity link claim"
        )
    if claim.status != IdentityLinkClaimStatus.PENDING:
        raise ConflictError("Identity link claim is not pending")
    if _past_expiry(claim):
        _expire_single(db, claim)
        raise ConflictError("Identity link claim has expired")
    if target_workspace.owner_id != actor.id and not actor.is_admin:
        raise AccessDeniedError(
            "Only a workspace owner may complete an identity link claim"
        )
    if target_member.workspace_id != target_workspace.id:
        raise InvalidInputError("Target member is not part of the target workspace")

    source_member = db.get(Member, claim.source_member_id)
    if source_member is None:
        raise ConflictError("The proposing member no longer exists")
    if source_member.workspace_id == target_member.workspace_id:
        raise InvalidInputError(
            "A member cannot be linked to a member in its own workspace"
        )
    source_workspace = db.get(Workspace, source_member.workspace_id)

    existing = get_link_between(db, source_member.id, target_member.id)
    if existing is not None and existing.status == IdentityLinkStatus.VERIFIED:
        raise ConflictError("Identity link already exists")

    member_a, member_b = _canonical_pair(source_member, target_member)
    ws_by_member = {
        source_member.id: source_workspace,
        target_member.id: target_workspace,
    }
    workspace_a, workspace_b = ws_by_member[member_a.id], ws_by_member[member_b.id]

    now = utcnow_iso()
    from_status = existing.status if existing is not None else None
    link = existing
    if link is None:
        link = IdentityLink(
            id=new_uuid(),
            member_a_id=member_a.id,
            member_b_id=member_b.id,
            workspace_a_id=workspace_a.id,
            workspace_b_id=workspace_b.id,
            verification_basis=IdentityLinkVerificationBasis.MUTUAL_CONSENT,
        )
    else:
        link.verification_basis = IdentityLinkVerificationBasis.MUTUAL_CONSENT
        link.approved_by_a = link.approved_at_a = None
        link.approved_by_b = link.approved_at_b = None
        link.verified_at = None
        link.decided_by = link.decided_at = link.decision_reason = None

    link.status = IdentityLinkStatus.PROPOSED
    link.proposed_by = claim.proposed_by
    link.proposed_at = now
    link.expires_at = _expiry(now)

    def _set_approval(member_id: str, approved_by: str, approved_at: str) -> None:
        if member_id == member_a.id:
            link.approved_by_a, link.approved_at_a = approved_by, approved_at
        else:
            link.approved_by_b, link.approved_at_b = approved_by, approved_at

    if claim.source_approved_by is not None:
        _set_approval(
            source_member.id, claim.source_approved_by, claim.source_approved_at
        )
    _set_approval(target_member.id, actor.id, now)
    _apply_verification_if_ready(link, now)

    claim.status = IdentityLinkClaimStatus.COMPLETED
    claim.decided_by = actor.id
    claim.decided_at = now
    claim.resulting_identity_link_id = link.id

    try:
        with UnitOfWork(db) as uow:
            db.add(link)
            db.flush()
            _record_event(
                db,
                link,
                IdentityLinkAction.PROPOSE,
                claim.proposed_by,
                from_status,
                link.status,
                None,
            )
            if claim.proposed_by is not None:
                proposer_id = claim.proposed_by
                uow.after_commit(
                    lambda: create_notification(
                        db,
                        proposer_id,
                        "identity_link_claim_decided",
                        IdentityLinkClaimDecidedPayload(
                            identity_link_claim_id=claim.id, status=claim.status
                        ),
                    )
                )
            if link.status == IdentityLinkStatus.VERIFIED:
                uow.after_commit(lambda: _notify_decision(db, link, actor.id))
    except StaleDataError as exc:
        raise ConflictError(
            "Identity link claim changed concurrently; reload and retry"
        ) from exc
    db.refresh(link)
    return link


def expire_stale_claims(db: Session) -> int:
    """Companion to ``identity_links.expire_stale_proposals`` for claims.

    Called from the same background sweep (``app.services.system.deletion_sweeper``).
    """
    now = utcnow_iso()
    stale = list(
        db.scalars(
            select(IdentityLinkClaim).where(
                IdentityLinkClaim.status == IdentityLinkClaimStatus.PENDING,
                IdentityLinkClaim.expires_at.is_not(None),
                IdentityLinkClaim.expires_at < now,
            )
        )
    )
    for claim in stale:
        claim.status = IdentityLinkClaimStatus.EXPIRED
        claim.decided_at = now
    if stale:
        with UnitOfWork(db):
            pass
    return len(stale)


def repoint_identity_link_claims_for_merge(
    db: Session, keep: Member, remove: Member
) -> None:
    """Carry ``remove``'s pending claims onto ``keep``, mirroring
    ``identity_links.repoint_identity_links_for_merge``."""
    rows = db.scalars(
        select(IdentityLinkClaim).where(IdentityLinkClaim.source_member_id == remove.id)
    ).all()
    for claim in rows:
        claim.source_member_id = keep.id
    db.flush()
