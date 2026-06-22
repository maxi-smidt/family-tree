"""Admin-only user management."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.security import hash_password
from app.db.session import get_db
from app.models import User
from app.schemas.user import UserCreate, UserOut, UserPasswordReset, UserUpdate
from app.services.event_bus import event_bus
from app.services.user_deletion import schedule_deletion

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_admin)])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.username)).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.username == payload.username)):
        raise HTTPException(status_code=409, detail="Username already taken")
    user = User(
        username=payload.username,
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        is_admin=payload.is_admin,
        auth_provider="local",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: str, payload: UserUpdate, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.email is not None:
        user.email = payload.email
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.password:
        _reset_local_password(user, payload.password)
    deactivated = payload.is_active is False
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.is_admin is not None:
        if not payload.is_admin and user.is_admin and _admin_count(db) <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last admin")
        user.is_admin = payload.is_admin
    # Quota fields: 0 is stored as-is (means "unlimited"); None leaves unchanged.
    # To clear a per-user quota (revert to instance default) pass null in the JSON.
    # We use a sentinel approach: the field validator allows ge=0, and we only
    # update when the key is present in the payload.
    if "tree_quota_bytes" in payload.model_fields_set:
        user.tree_quota_bytes = payload.tree_quota_bytes
    if "media_quota_bytes" in payload.model_fields_set:
        user.media_quota_bytes = payload.media_quota_bytes

    db.commit()
    db.refresh(user)
    if deactivated:
        event_bus.publish([user.id], "session.invalidate", {"reason": "deactivated"})
    return user


@router.post("/{user_id}/reset-password", response_model=UserOut)
def reset_password(
    user_id: str,
    payload: UserPasswordReset,
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    _reset_local_password(user, payload.password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", response_model=UserOut)
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    """Schedule an account for deletion after the configured grace period.

    The account is not purged here: it enters a *pending deletion* state (blocked
    from logging in) until the deadline passes, at which point a background sweep
    removes it. An admin can reverse this via ``cancel_deletion`` beforehand.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if user.is_admin and _admin_count(db) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin")

    schedule_deletion(db, user, requested_by=current.id)
    event_bus.publish([user.id], "session.invalidate", {"reason": "pending_deletion"})
    return user


@router.delete("/{user_id}/2fa", response_model=UserOut)
def reset_totp(user_id: str, db: Session = Depends(get_db)):
    """Admin: remove TOTP 2FA from a user account (lockout recovery)."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.totp_enabled = False
    user.totp_secret = None
    user.totp_recovery_codes = None
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/cancel-deletion", response_model=UserOut)
def cancel_deletion(user_id: str, db: Session = Depends(get_db)):
    """Reverse a scheduled deletion, restoring the account's access."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.deletion_requested_at = None
    user.deletion_scheduled_for = None
    user.deletion_requested_by = None
    db.commit()
    db.refresh(user)
    return user


def _admin_count(db: Session) -> int:
    return db.scalar(
        select(func.count()).select_from(User).where(User.is_admin.is_(True))
    )


def _reset_local_password(user: User, password: str) -> None:
    if user.auth_provider != "local":
        raise HTTPException(
            status_code=400,
            detail="Password reset is only available for local accounts",
        )
    user.hashed_password = hash_password(password)
