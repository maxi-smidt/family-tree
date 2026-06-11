from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import ACCOUNT_PENDING_DELETION, get_current_user
from app.core.config import settings
from app.core.rate_limit import login_rate_limiter
from app.core.security import (
    create_access_token,
    hash_password,
    run_dummy_verify,
    verify_password,
)
from app.db.session import get_db
from app.models import User
from app.schemas.auth import AuthConfig, LoginRequest, Token
from app.schemas.user import (
    AccountRestore,
    AccountSelfDelete,
    PasswordChange,
    UserCreate,
    UserOut,
)
from app.services.settings_service import get_bool_setting
from app.services.user_deletion import schedule_deletion

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/config", response_model=AuthConfig)
def auth_config(db: Session = Depends(get_db)):
    login_url = (
        f"{settings.API_PREFIX}/auth/oauth/authentik/login"
        if settings.authentik_enabled
        else None
    )
    return AuthConfig(
        authentik_enabled=settings.authentik_enabled,
        allow_self_registration=get_bool_setting(db, "allow_self_registration", False),
        authentik_login_url=login_url,
    )


@router.post("/login", response_model=Token)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:{payload.username.lower()}"
    retry_after = login_rate_limiter.retry_after(rate_key)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please try again later.",
            headers={"Retry-After": str(int(retry_after) + 1)},
        )

    user = db.scalar(select(User).where(User.username == payload.username))
    if user is None or user.hashed_password is None:
        run_dummy_verify(payload.password)
        login_rate_limiter.record_failure(rate_key)
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if not verify_password(payload.password, user.hashed_password):
        login_rate_limiter.record_failure(rate_key)
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    if user.deletion_requested_at is not None:
        raise HTTPException(status_code=403, detail=ACCOUNT_PENDING_DELETION)

    login_rate_limiter.reset(rate_key)
    token = create_access_token(user.id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.post("/register", response_model=Token)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    self_registration = settings.ALLOW_SELF_REGISTRATION or get_bool_setting(
        db, "allow_self_registration", False
    )
    if not self_registration:
        raise HTTPException(status_code=403, detail="Self-registration is disabled")

    exists = db.scalar(select(User).where(User.username == payload.username))
    if exists:
        raise HTTPException(status_code=409, detail="Username already taken")

    # The very first registered account becomes an admin.
    is_first = db.scalar(select(func.count()).select_from(User)) == 0
    user = User(
        username=payload.username,
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        is_admin=is_first,
        auth_provider="local",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/delete-account", response_model=UserOut)
def delete_account(
    payload: AccountSelfDelete,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Schedule deletion of the calling user's own account.

    Local accounts must supply their current password; OIDC accounts confirm by
    repeating their username.  The last admin cannot self-delete.
    """
    if user.is_admin:
        admin_count = db.scalar(
            select(func.count()).select_from(User).where(User.is_admin.is_(True))
        )
        if admin_count <= 1:
            raise HTTPException(
                status_code=400, detail="cannot_delete_last_admin"
            )

    if user.auth_provider == "local":
        if not payload.password:
            raise HTTPException(status_code=400, detail="Password is required")
        if user.hashed_password is None or not verify_password(
            payload.password, user.hashed_password
        ):
            raise HTTPException(status_code=400, detail="Incorrect password")
    else:
        if not payload.confirm_username:
            raise HTTPException(
                status_code=400, detail="Username confirmation is required"
            )
        if payload.confirm_username != user.username:
            raise HTTPException(status_code=400, detail="Username does not match")

    schedule_deletion(db, user, requested_by=user.id)
    return user


@router.post("/restore-account", response_model=Token)
def restore_account(
    payload: AccountRestore,
    request: Request,
    db: Session = Depends(get_db),
):
    """Restore an account the user themselves scheduled for deletion.

    Verifies credentials, checks that the deletion was self-initiated, then
    clears the pending-deletion state and issues a fresh token.  Admin-initiated
    deletions cannot be reversed here; the user must contact an administrator.
    """
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:{payload.username.lower()}"
    retry_after = login_rate_limiter.retry_after(rate_key)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please try again later.",
            headers={"Retry-After": str(int(retry_after) + 1)},
        )

    user = db.scalar(select(User).where(User.username == payload.username))
    if user is None or user.hashed_password is None:
        run_dummy_verify(payload.password)
        login_rate_limiter.record_failure(rate_key)
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if not verify_password(payload.password, user.hashed_password):
        login_rate_limiter.record_failure(rate_key)
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    if user.deletion_requested_at is None:
        raise HTTPException(status_code=400, detail="Account is not pending deletion")
    if user.deletion_requested_by != user.id:
        raise HTTPException(status_code=403, detail="admin_initiated_deletion")

    user.deletion_requested_at = None
    user.deletion_scheduled_for = None
    user.deletion_requested_by = None
    db.commit()
    db.refresh(user)

    login_rate_limiter.reset(rate_key)
    token = create_access_token(user.id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.post("/password", status_code=204)
def change_password(
    payload: PasswordChange,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.hashed_password is None or not verify_password(
        payload.current_password, user.hashed_password
    ):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.hashed_password = hash_password(payload.new_password)
    db.commit()
