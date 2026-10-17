"""Authentik OpenID Connect login flow."""

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.models import User
from app.services.system.admin_audit import record_admin_audit
from app.services.system.authentik import get_client
from app.services.unit_of_work import UnitOfWork

router = APIRouter(prefix="/auth/oauth/authentik", tags=["auth"])


def _redirect_uri() -> str:
    return f"{settings.FRONTEND_URL}{settings.API_PREFIX}/auth/oauth/authentik/callback"


@router.get("/login")
async def login(request: Request):
    if not settings.authentik_enabled:
        raise HTTPException(status_code=404, detail="Authentik login is not configured")
    client = get_client()
    return await client.authorize_redirect(request, _redirect_uri())


@router.get("/callback")
async def callback(request: Request, db: Session = Depends(get_db)):
    if not settings.authentik_enabled:
        raise HTTPException(status_code=404, detail="Authentik login is not configured")

    client = get_client()
    try:
        token = await client.authorize_access_token(request)
    except Exception:  # noqa: BLE001
        return RedirectResponse(f"{settings.FRONTEND_URL}/#oauth_error=1")

    userinfo = token.get("userinfo") or await client.userinfo(token=token)
    subject = userinfo.get("sub")
    if not subject:
        return RedirectResponse(f"{settings.FRONTEND_URL}/#oauth_error=1")

    user = _provision_user(db, userinfo)
    if user is None:
        return RedirectResponse(f"{settings.FRONTEND_URL}/#oauth_error=nouser")
    if user.deletion_requested_at is not None:
        return RedirectResponse(f"{settings.FRONTEND_URL}/#oauth_error=pending_deletion")

    with UnitOfWork(db):
        record_admin_audit(
            db,
            actor=user,
            action="create",
            subject_type="auth_login",
            subject_id=user.id,
            subject_label=user.username,
            details={"provider": "authentik"},
        )
    access = create_access_token(user.id)
    return RedirectResponse(f"{settings.FRONTEND_URL}/#token={access}")


def _provision_user(db: Session, userinfo: dict) -> User | None:
    subject = userinfo["sub"]
    email = userinfo.get("email")
    username = (
        userinfo.get("preferred_username") or email or userinfo.get("nickname") or subject
    )
    groups = userinfo.get("groups") or []
    is_admin = settings.AUTHENTIK_ADMIN_GROUP in groups

    user = db.scalar(select(User).where(User.oauth_subject == subject))
    if user is None and email:
        user = db.scalar(select(User).where(User.email == email))

    with UnitOfWork(db):
        if user is None:
            if not settings.AUTHENTIK_AUTO_CREATE_USERS:
                return None
            user = User(
                username=_unique_username(db, username),
                email=email,
                full_name=userinfo.get("name"),
                auth_provider="authentik",
                oauth_subject=subject,
                is_admin=is_admin,
            )
            db.add(user)
            db.flush()
            record_admin_audit(
                db,
                actor=user,
                action="create",
                subject_type="user",
                subject_id=user.id,
                subject_label=user.username,
                details={"provider": "authentik", "is_admin": user.is_admin},
            )
        else:
            user.oauth_subject = subject
            # Sync admin status unconditionally for Authentik users so that
            # removing a user from the group revokes admin on the very next login.
            # Local accounts matched by email are intentionally left untouched so
            # that local admin rights remain under local control.
            if settings.AUTHENTIK_ADMIN_GROUP and user.auth_provider == "authentik":
                user.is_admin = is_admin  # unconditional sync: grants AND revokes
    db.refresh(user)
    return user


def _unique_username(db: Session, base: str) -> str:
    candidate = base
    suffix = 1
    while db.scalar(select(User).where(User.username == candidate)) is not None:
        suffix += 1
        candidate = f"{base}{suffix}"
    return candidate
