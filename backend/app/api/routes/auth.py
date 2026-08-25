import mimetypes

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import ACCOUNT_PENDING_DELETION, get_current_user
from app.core.config import settings
from app.core.rate_limit import login_rate_limiter
from app.core.security import (
    consume_recovery_code,
    create_access_token,
    create_totp_session_token,
    decode_totp_session_token,
    generate_recovery_codes,
    generate_totp_secret,
    get_totp_provisioning_uri,
    hash_password,
    hash_recovery_codes,
    run_dummy_verify,
    verify_password,
    verify_totp_code,
)
from app.db.session import get_db
from app.models import User
from app.schemas.auth import (
    AuthConfig,
    LoginRequest,
    LoginResponse,
    Token,
    TotpDisableRequest,
    TotpEnableRequest,
    TotpEnableResponse,
    TotpSetupResponse,
    TotpVerifyRequest,
)
from app.schemas.user import (
    AccountRestore,
    AccountSelfDelete,
    CurrentUserOut,
    PasswordChange,
    StoredUserPreferences,
    UserCreate,
    UserOut,
    UserProfileUpdate,
)
from app.services.media.storage import (
    ImageTooLarge,
    UnsupportedImageType,
    delete_profile_image,
    profile_image_path,
    store_profile_image_upload,
)
from app.services.system.admin_audit import record_admin_audit
from app.services.system.settings_service import (
    effective_storage_mode,
    get_bool_setting,
    get_media_limits,
    user_has_accepted_legal,
)
from app.services.system.user_deletion import schedule_deletion
from app.services.unit_of_work import UnitOfWork

router = APIRouter(prefix="/auth", tags=["auth"])


def _current_user_out(db: Session, user: User) -> CurrentUserOut:
    out = CurrentUserOut.model_validate(user)
    limits = get_media_limits(db)
    user_mode = StoredUserPreferences.model_validate(
        user.preferences or {}
    ).image_storage_mode
    out.image_storage_allowed_modes = list(limits.image_storage_allowed_modes)
    out.image_storage_mode = effective_storage_mode(
        limits.image_storage_mode, limits.image_storage_allowed_modes, user_mode
    )
    out.legal_acceptance_required = get_bool_setting(
        db, "legal_acceptance_required", True
    )
    out.legal_accepted = user_has_accepted_legal(db, user)
    if user.profile_image:
        out.profile_image_url = (
            f"{settings.API_PREFIX}/auth/profile/image/{user.profile_image}"
        )
    return out


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
        media_limits=get_media_limits(db),
    )


@router.post("/login", response_model=LoginResponse)
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
        login_rate_limiter.record_hit(rate_key)
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if not verify_password(payload.password, user.hashed_password):
        login_rate_limiter.record_hit(rate_key)
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    if user.deletion_requested_at is not None:
        raise HTTPException(status_code=403, detail=ACCOUNT_PENDING_DELETION)

    login_rate_limiter.reset(rate_key)

    if user.totp_enabled:
        session_token = create_totp_session_token(user.id)
        return LoginResponse(totp_required=True, totp_session_token=session_token)

    with UnitOfWork(db):
        record_admin_audit(
            db,
            actor=user,
            action="create",
            subject_type="auth_login",
            subject_id=user.id,
            subject_label=user.username,
        )
    token = create_access_token(user.id)
    return LoginResponse(access_token=token, user=_current_user_out(db, user))


@router.post("/totp", response_model=Token)
def verify_totp(
    payload: TotpVerifyRequest, request: Request, db: Session = Depends(get_db)
):
    """Complete a two-factor login by verifying the TOTP code (or a recovery code)."""
    import jwt as pyjwt

    try:
        user_id = decode_totp_session_token(payload.session_token)
    except pyjwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=401, detail="Invalid or expired session token"
        ) from exc

    user = db.get(User, user_id)
    if user is None or not user.totp_enabled or user.totp_secret is None:
        raise HTTPException(status_code=401, detail="Invalid session")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    if user.deletion_requested_at is not None:
        raise HTTPException(status_code=403, detail=ACCOUNT_PENDING_DELETION)

    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:{user.username.lower()}:totp"
    retry_after = login_rate_limiter.retry_after(rate_key)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(int(retry_after) + 1)},
        )

    code = payload.code.strip()
    if verify_totp_code(user.totp_secret, code):
        login_rate_limiter.reset(rate_key)
    else:
        remaining = consume_recovery_code(code, user.totp_recovery_codes or [])
        if remaining is None:
            login_rate_limiter.record_hit(rate_key)
            raise HTTPException(status_code=401, detail="Invalid code")
        with UnitOfWork(db):
            user.totp_recovery_codes = remaining
        login_rate_limiter.reset(rate_key)

    with UnitOfWork(db):
        record_admin_audit(
            db,
            actor=user,
            action="create",
            subject_type="auth_login",
            subject_id=user.id,
            subject_label=user.username,
            details={"two_factor": True},
        )
    token = create_access_token(user.id)
    return Token(access_token=token, user=_current_user_out(db, user))


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
    db.flush()
    with UnitOfWork(db):
        record_admin_audit(
            db,
            actor=user,
            action="create",
            subject_type="user",
            subject_id=user.id,
            subject_label=user.username,
            details={"self_registration": True, "is_admin": is_first},
        )
    db.refresh(user)
    token = create_access_token(user.id)
    return Token(access_token=token, user=_current_user_out(db, user))


@router.get("/me", response_model=CurrentUserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _current_user_out(db, user)


@router.post("/refresh", response_model=Token)
def refresh_access_token(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Issue a new access token while the current session is still valid."""
    token = create_access_token(user.id)
    return Token(access_token=token, user=_current_user_out(db, user))


@router.patch("/profile", response_model=CurrentUserOut)
def update_profile(
    payload: UserProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update only the calling user's profile names."""
    changes = payload.model_dump(exclude_unset=True)
    with UnitOfWork(db):
        for field, value in changes.items():
            setattr(user, field, value)
    db.refresh(user)
    return _current_user_out(db, user)


@router.post("/profile/image", response_model=CurrentUserOut)
async def upload_profile_image(
    image: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stream, validate and persist a private profile image for the caller."""
    old_filename = user.profile_image
    try:
        filename = await store_profile_image_upload(user.id, image, get_media_limits(db))
    except ImageTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (UnsupportedImageType, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await image.close()

    try:
        with UnitOfWork(db):
            user.profile_image = filename
    except Exception:
        delete_profile_image(user.id, filename)
        raise
    db.refresh(user)

    delete_profile_image(user.id, old_filename)
    return _current_user_out(db, user)


@router.get("/profile/image/{filename}")
def get_profile_image(
    filename: str,
    user: User = Depends(get_current_user),
):
    """Serve only the caller's current profile image.

    The route intentionally has no user id: it cannot be used to enumerate or
    read another account's media, even by an administrator.
    """
    if user.profile_image != filename:
        raise HTTPException(status_code=404, detail="Profile image not found")
    path = profile_image_path(user.id, filename)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Profile image not found")
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type)


@router.delete("/profile/image", response_model=CurrentUserOut)
def remove_profile_image(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear the caller's profile image and remove its private media bytes."""
    filename = user.profile_image
    with UnitOfWork(db):
        user.profile_image = None
    db.refresh(user)
    delete_profile_image(user.id, filename)
    return _current_user_out(db, user)


@router.post("/delete-account", response_model=UserOut)
def delete_account(
    payload: AccountSelfDelete,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Schedule deletion of the calling user's own account."""
    if user.is_admin:
        admin_count = db.scalar(
            select(func.count()).select_from(User).where(User.is_admin.is_(True))
        )
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="cannot_delete_last_admin")

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

    with UnitOfWork(db):
        schedule_deletion(db, user, requested_by=user.id)
        record_admin_audit(
            db,
            actor=user,
            action="delete",
            subject_type="user",
            subject_id=user.id,
            subject_label=user.username,
            details={"scheduled": True, "self_service": True},
        )
    return user


@router.post("/restore-account", response_model=Token)
def restore_account(
    payload: AccountRestore,
    request: Request,
    db: Session = Depends(get_db),
):
    """Restore an account the user themselves scheduled for deletion."""
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
        login_rate_limiter.record_hit(rate_key)
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if not verify_password(payload.password, user.hashed_password):
        login_rate_limiter.record_hit(rate_key)
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    if user.deletion_requested_at is None:
        raise HTTPException(status_code=400, detail="Account is not pending deletion")
    if user.deletion_requested_by != user.id:
        raise HTTPException(status_code=403, detail="admin_initiated_deletion")

    with UnitOfWork(db):
        user.deletion_requested_at = None
        user.deletion_scheduled_for = None
        user.deletion_requested_by = None
        record_admin_audit(
            db,
            actor=user,
            action="update",
            subject_type="user",
            subject_id=user.id,
            subject_label=user.username,
            details={"restored": True},
        )
    db.refresh(user)

    login_rate_limiter.reset(rate_key)
    token = create_access_token(user.id)
    return Token(access_token=token, user=_current_user_out(db, user))


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
    with UnitOfWork(db):
        user.hashed_password = hash_password(payload.new_password)
        record_admin_audit(
            db,
            actor=user,
            action="update",
            subject_type="password",
            subject_id=user.id,
            subject_label=user.username,
        )


# ---------------------------------------------------------------------------
# Two-factor authentication management (local accounts only)
# ---------------------------------------------------------------------------


@router.get("/2fa/qr-code")
def totp_qr_code(
    user: User = Depends(get_current_user),
):
    """Return the current TOTP provisioning URI as a QR code PNG (base64 data URI).

    Only valid while a totp_secret is stored (between setup and enable/cancel).
    """
    import base64
    import io

    import qrcode

    if user.totp_secret is None:
        raise HTTPException(status_code=404, detail="No TOTP setup in progress")

    uri = get_totp_provisioning_uri(user.totp_secret, user.username)
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data = base64.b64encode(buf.getvalue()).decode()
    return {"data_url": f"data:image/png;base64,{data}"}


@router.post("/2fa/setup", response_model=TotpSetupResponse)
def setup_totp(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Begin TOTP enrollment.

    Generates a new secret and returns the provisioning URI.  The secret is
    stored but 2FA is NOT yet active until /2fa/enable is called with a valid
    code.
    """
    if user.auth_provider != "local":
        raise HTTPException(
            status_code=400, detail="2FA is only available for local accounts"
        )

    secret = generate_totp_secret()
    # Generate recovery codes now so they can be shown to the user during setup.
    recovery_codes = generate_recovery_codes()
    with UnitOfWork(db):
        user.totp_secret = secret
        # Store hashed codes; they become valid once 2FA is enabled.
        user.totp_recovery_codes = hash_recovery_codes(recovery_codes)

    uri = get_totp_provisioning_uri(secret, user.username)
    return TotpSetupResponse(
        secret=secret,
        otpauth_url=uri,
        recovery_codes=recovery_codes,
    )


@router.post("/2fa/enable", response_model=TotpEnableResponse)
def enable_totp(
    payload: TotpEnableRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Confirm TOTP enrollment by submitting the first valid code.

    Activates 2FA.  Recovery codes were provided during setup.
    """
    if user.totp_secret is None:
        raise HTTPException(status_code=400, detail="2FA setup not initiated")
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is already enabled")
    if not verify_totp_code(user.totp_secret, payload.code.strip()):
        raise HTTPException(status_code=400, detail="Invalid code")

    with UnitOfWork(db):
        user.totp_enabled = True
        record_admin_audit(
            db,
            actor=user,
            action="update",
            subject_type="two_factor",
            subject_id=user.id,
            subject_label=user.username,
            details={"enabled": True},
        )
    return TotpEnableResponse(totp_enabled=True)


@router.post("/2fa/disable", status_code=204)
def disable_totp(
    payload: TotpDisableRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Disable TOTP 2FA.  Requires the current password and a valid TOTP/recovery code."""
    if not user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled")
    if user.hashed_password is None or not verify_password(
        payload.password, user.hashed_password
    ):
        raise HTTPException(status_code=400, detail="Incorrect password")

    code = payload.code.strip()
    if not verify_totp_code(user.totp_secret or "", code):
        remaining = consume_recovery_code(code, user.totp_recovery_codes or [])
        if remaining is None:
            raise HTTPException(status_code=400, detail="Invalid code")

    with UnitOfWork(db):
        user.totp_enabled = False
        user.totp_secret = None
        user.totp_recovery_codes = None
        record_admin_audit(
            db,
            actor=user,
            action="update",
            subject_type="two_factor",
            subject_id=user.id,
            subject_label=user.username,
            details={"enabled": False},
        )
