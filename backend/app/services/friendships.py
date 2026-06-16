"""Friendship lookups, state transitions and share-side effects.

There is at most one ``Friendship`` row per unordered user pair. Helpers here
always consider both orderings so callers never have to care who originally sent
the request.
"""

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.models import Friendship, Tree, TreeMembership, User
from app.schemas.friendship import FriendOut


def get_friendship(db: Session, a_id: str, b_id: str) -> Friendship | None:
    """The friendship between two users regardless of who requested it."""
    return db.scalar(
        select(Friendship).where(
            or_(
                (Friendship.requester_id == a_id)
                & (Friendship.addressee_id == b_id),
                (Friendship.requester_id == b_id)
                & (Friendship.addressee_id == a_id),
            )
        )
    )


def are_friends(db: Session, a_id: str, b_id: str) -> bool:
    """True iff an accepted friendship exists between the two users."""
    friendship = get_friendship(db, a_id, b_id)
    return friendship is not None and friendship.status == "accepted"


def accepted_friend_ids(db: Session, user_id: str) -> set[str]:
    """Ids of every user that ``user_id`` is accepted friends with."""
    rows = db.scalars(
        select(Friendship).where(
            (Friendship.status == "accepted")
            & or_(
                Friendship.requester_id == user_id,
                Friendship.addressee_id == user_id,
            )
        )
    ).all()
    return {
        row.addressee_id if row.requester_id == user_id else row.requester_id
        for row in rows
    }


def revoke_shared_memberships(db: Session, a_id: str, b_id: str) -> None:
    """Drop any tree memberships shared between the two users, both directions.

    Keeps the invariant *shared ⇒ friends* true after an unfriend: a membership
    on a tree ``a`` owns granted to ``b`` (or vice-versa) is removed.
    """
    memberships = db.scalars(
        select(TreeMembership)
        .join(Tree, Tree.id == TreeMembership.tree_id)
        .where(
            or_(
                (Tree.owner_id == a_id) & (TreeMembership.user_id == b_id),
                (Tree.owner_id == b_id) & (TreeMembership.user_id == a_id),
            )
        )
    ).all()
    for membership in memberships:
        db.delete(membership)


def to_friend_out(db: Session, friendship: Friendship, viewer_id: str) -> FriendOut:
    """Render a friendship row from ``viewer_id``'s perspective."""
    other_id = (
        friendship.addressee_id
        if friendship.requester_id == viewer_id
        else friendship.requester_id
    )
    other = db.get(User, other_id)
    # "incoming" when the still-pending request was sent *to* the viewer.
    direction = "incoming" if friendship.addressee_id == viewer_id else "outgoing"
    return FriendOut(
        user_id=other_id,
        username=other.username if other else "",
        full_name=other.full_name if other else None,
        status=friendship.status,
        direction=direction,
        created_at=friendship.created_at,
        responded_at=friendship.responded_at,
    )


def send_request(db: Session, requester: User, addressee: User) -> Friendship:
    """Create or advance a friend request from ``requester`` to ``addressee``.

    Idempotent and order-aware:
    - a reverse pending request is accepted (mutual interest),
    - a previously declined row is re-opened as pending,
    - an existing accepted/pending/blocked row is returned unchanged.
    """
    existing = get_friendship(db, requester.id, addressee.id)
    if existing is not None:
        if existing.status == "declined":
            # Re-open: the current sender becomes the requester again.
            existing.requester_id = requester.id
            existing.addressee_id = addressee.id
            existing.status = "pending"
            existing.created_at = utcnow_iso()
            existing.responded_at = None
        elif existing.status == "pending" and existing.addressee_id == requester.id:
            # The other side already asked us — accept it.
            existing.status = "accepted"
            existing.responded_at = utcnow_iso()
        db.commit()
        db.refresh(existing)
        return existing

    friendship = Friendship(
        requester_id=requester.id,
        addressee_id=addressee.id,
        status="pending",
    )
    db.add(friendship)
    db.commit()
    db.refresh(friendship)
    return friendship
