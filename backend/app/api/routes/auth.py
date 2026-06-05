from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models import User
from app.schemas.auth import AuthConfig, LoginRequest, Token
from app.schemas.user import PasswordChange, UserCreate, UserOut
from app.services.settings_service import get_bool_setting

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
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username))
    if (
        user is None
        or user.hashed_password is None
        or not verify_password(payload.password, user.hashed_password)
    ):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token(user.id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.post("/register", response_model=Token)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    if not (settings.ALLOW_SELF_REGISTRATION or get_bool_setting(db, "allow_self_registration", False)):
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
