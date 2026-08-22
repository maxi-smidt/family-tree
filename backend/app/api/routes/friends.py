"""Friend requests, the accepted-friends graph, and private friend avatars.

Authenticated users only. Tree sharing with a registered user is gated on an
accepted friendship (enforced in ``trees.py``); this router is how those
friendships are formed and torn down. Profile images are exposed only through
the accepted-friend route below, never through the general tree-media route.
"""

import mimetypes

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import Friendship, Tree, User
from app.schemas.friendship import FriendOut, FriendRequestCreate, UserSearchResult
from app.schemas.notification import (
    FriendRequestAcceptedPayload,
    FriendRequestReceivedPayload,
    TreeUnsharedPayload,
)
from app.services import friendships, notification_service
from app.services.event_bus import event_bus, publish_tree_event
from app.services.media.storage import profile_image_path

router = APIRouter(prefix="/friends", tags=["friends"])

_SEARCH_LIMIT = 20


def _friendships_for(db: Session, user_id: str, *, status: str) -> list[Friendship]:
    return list(
        db.scalars(
            select(Friendship).where(
                (Friendship.status == status)
                & or_(
                    Friendship.requester_id == user_id,
                    Friendship.addressee_id == user_id,
                )
            )
        ).all()
    )


def _notify_revoked_memberships(
    db: Session, revoked: list[tuple[Tree, str]]
) -> None:
    """Notify users who lost tree access through an unfriend/block.

    Mirrors the explicit unshare route (``trees.revoke_access``): the activity
    entry (logged by ``revoke_shared_memberships`` before commit) is
    broadcast via ``activity.entry_added``, a realtime ``tree.access_changed``
    event so open sessions react immediately, plus a durable inbox
    notification. Must run after the membership deletion is committed —
    ``publish_tree_event`` computes its audience from the committed rows and
    reaches the revoked user via ``extra_user_ids``.
    """
    for tree, revoked_user_id in revoked:
        publish_tree_event(
            db,
            tree,
            "tree.access_changed",
            {"tree_id": tree.id},
            extra_user_ids=[revoked_user_id],
        )
        publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
        notification_service.create_notification(
            db,
            revoked_user_id,
            "tree_unshared",
            TreeUnsharedPayload(tree_id=tree.id, tree_name=tree.name),
        )


@router.get("", response_model=list[FriendOut])
def list_friends(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = _friendships_for(db, user.id, status="accepted")
    out = [friendships.to_friend_out(db, row, user.id) for row in rows]
    out.sort(key=lambda f: f.username.lower())
    return out


@router.get("/incoming", response_model=list[FriendOut])
def list_incoming(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Friendship).where(
            (Friendship.status == "pending")
            & (Friendship.addressee_id == user.id)
        )
    ).all()
    return [friendships.to_friend_out(db, row, user.id) for row in rows]


@router.get("/outgoing", response_model=list[FriendOut])
def list_outgoing(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Friendship).where(
            (Friendship.status == "pending")
            & (Friendship.requester_id == user.id)
        )
    ).all()
    return [friendships.to_friend_out(db, row, user.id) for row in rows]


@router.get("/search", response_model=list[UserSearchResult])
def search_users(
    q: str = "",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Find active users by username. Returns nothing for an empty query so the
    full user list is never enumerable. Emails are never exposed."""
    term = q.strip()
    if not term:
        return []
    matches = db.scalars(
        select(User)
        .where(
            func.lower(User.username).contains(term.lower()),
            User.id != user.id,
            User.id.not_in(friendships.accepted_friend_ids(db, user.id)),
            User.is_active.is_(True),
            User.deletion_requested_at.is_(None),
        )
        .order_by(User.username)
        .limit(_SEARCH_LIMIT)
    ).all()
    results: list[UserSearchResult] = []
    for match in matches:
        friendship = friendships.get_friendship(db, user.id, match.id)
        direction = None
        if friendship is not None and friendship.status == "pending":
            direction = (
                "incoming" if friendship.addressee_id == user.id else "outgoing"
            )
        results.append(
            UserSearchResult(
                user_id=match.id,
                username=match.username,
                full_name=match.full_name,
                status=friendship.status if friendship else None,
                direction=direction,
            )
        )
    return results


@router.post("/requests", response_model=FriendOut, status_code=201)
def send_request(
    payload: FriendRequestCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target = db.scalar(select(User).where(User.username == payload.username))
    if target is None or not target.is_active or target.deletion_requested_at:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="You cannot friend yourself")

    existing = friendships.get_friendship(db, user.id, target.id)
    if existing is not None and existing.status == "blocked":
        raise HTTPException(status_code=403, detail="Friend request not allowed")

    friendship = friendships.send_request(db, user, target)
    if friendship.status == "pending" and friendship.addressee_id == target.id:
        event_bus.publish(
            [target.id],
            "friend.request_received",
            {"requester_id": user.id, "requester_username": user.username},
        )
        notification_service.create_notification(
            db,
            target.id,
            "friend_request_received",
            FriendRequestReceivedPayload(
                requester_id=user.id, requester_username=user.username
            ),
        )
    return friendships.to_friend_out(db, friendship, user.id)


@router.get("/{user_id}/profile-image/{filename}")
def get_friend_profile_image(
    user_id: str,
    filename: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve an accepted friend's current profile image to that friend only."""
    target = db.get(User, user_id)
    if (
        target is None
        or target.profile_image != filename
        or not friendships.are_friends(db, user.id, target.id)
    ):
        raise HTTPException(status_code=404, detail="Profile image not found")

    path = profile_image_path(target.id, filename)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Profile image not found")
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type)


def _require_friendship(db: Session, user: User, other_id: str) -> Friendship:
    friendship = friendships.get_friendship(db, user.id, other_id)
    if friendship is None:
        raise HTTPException(status_code=404, detail="Friendship not found")
    return friendship


@router.post("/{user_id}/accept", response_model=FriendOut)
def accept_request(
    user_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    friendship = _require_friendship(db, user, user_id)
    if friendship.status != "pending" or friendship.addressee_id != user.id:
        raise HTTPException(status_code=400, detail="No pending request to accept")
    friendship.status = "accepted"
    friendship.responded_at = utcnow_iso()
    db.commit()
    db.refresh(friendship)
    notification_service.create_notification(
        db,
        friendship.requester_id,
        "friend_request_accepted",
        FriendRequestAcceptedPayload(
            addressee_id=user.id, addressee_username=user.username
        ),
    )
    return friendships.to_friend_out(db, friendship, user.id)


@router.post("/{user_id}/decline", status_code=204)
def decline_request(
    user_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    friendship = _require_friendship(db, user, user_id)
    if friendship.status != "pending" or friendship.addressee_id != user.id:
        raise HTTPException(status_code=400, detail="No pending request to decline")
    friendship.status = "declined"
    friendship.responded_at = utcnow_iso()
    db.commit()


@router.delete("/{user_id}", status_code=204)
def remove_friend(
    user_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Unfriend or cancel an outgoing request. Removing an accepted friendship
    also revokes any trees shared between the two users (both directions)."""
    friendship = friendships.get_friendship(db, user.id, user_id)
    if friendship is None:
        return
    was_accepted = friendship.status == "accepted"
    db.delete(friendship)
    revoked = (
        friendships.revoke_shared_memberships(db, user, user_id)
        if was_accepted
        else []
    )
    db.commit()
    _notify_revoked_memberships(db, revoked)


@router.post("/{user_id}/block", status_code=204)
def block_user(
    user_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot block yourself")
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    friendship = friendships.get_friendship(db, user.id, user_id)
    if friendship is None:
        friendship = Friendship(requester_id=user.id, addressee_id=user_id)
        db.add(friendship)
    # The blocker becomes the requester so unblock can verify ownership.
    friendship.requester_id = user.id
    friendship.addressee_id = user_id
    friendship.status = "blocked"
    friendship.responded_at = utcnow_iso()
    revoked = friendships.revoke_shared_memberships(db, user, user_id)
    db.commit()
    _notify_revoked_memberships(db, revoked)


@router.delete("/{user_id}/block", status_code=204)
def unblock_user(
    user_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    friendship = friendships.get_friendship(db, user.id, user_id)
    if (
        friendship is not None
        and friendship.status == "blocked"
        and friendship.requester_id == user.id
    ):
        db.delete(friendship)
        db.commit()
