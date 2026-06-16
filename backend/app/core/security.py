"""Password hashing, JWT helpers, and TOTP utilities."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
import pyotp

from app.core.config import settings

# Pre-computed bcrypt hash used to keep login timing constant when a username
# does not exist.  Running checkpw against this costs the same ~100 ms as a
# real verification, so an attacker cannot distinguish "no such user" from
# "wrong password" via timing.  The hash was produced with cost 12.
_DUMMY_HASH = "$2b$12$KIXg6AgQTnrCFHFIGCTNBuZPTBWTMqxVl4dsBXixf1/6T6MWjFLPS"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def run_dummy_verify(password: str) -> None:
    """Run a full bcrypt verification against the dummy hash and discard the result.

    Call this whenever a login-path early-exit would otherwise skip bcrypt
    (e.g. unknown username, no stored hash).  The full key derivation keeps the
    response time indistinguishable from a legitimate failed login.
    """
    verify_password(password, _DUMMY_HASH)


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {"sub": subject, "exp": expire, "iat": datetime.now(UTC)}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])


# ---------------------------------------------------------------------------
# TOTP session tokens (short-lived JWTs used between the password step and
# the TOTP verification step of a two-factor login).
# ---------------------------------------------------------------------------

_TOTP_SESSION_MINUTES = 5
_TOTP_PHASE_CLAIM = "totp_pending"


def create_totp_session_token(user_id: str) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=_TOTP_SESSION_MINUTES)
    payload = {
        "sub": user_id,
        "exp": expire,
        "iat": datetime.now(UTC),
        "phase": _TOTP_PHASE_CLAIM,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_totp_session_token(token: str) -> str:
    """Validate a TOTP session token; return the user id or raise InvalidTokenError."""
    data = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    if data.get("phase") != _TOTP_PHASE_CLAIM:
        raise jwt.InvalidTokenError("Not a TOTP session token")
    return data["sub"]


# ---------------------------------------------------------------------------
# TOTP / recovery-code helpers
# ---------------------------------------------------------------------------

_TOTP_ISSUER = "Family Tree"
_RECOVERY_CODE_COUNT = 8


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def get_totp_provisioning_uri(secret: str, username: str) -> str:
    return pyotp.totp.TOTP(secret).provisioning_uri(
        name=username, issuer_name=_TOTP_ISSUER
    )


def verify_totp_code(secret: str, code: str) -> bool:
    """Accept codes in a ±1 step window to tolerate minor clock drift."""
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def generate_recovery_codes() -> list[str]:
    codes = []
    for _ in range(_RECOVERY_CODE_COUNT):
        raw = secrets.token_hex(5).upper()
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def _hash_recovery_code(code: str) -> str:
    normalised = code.upper().replace("-", "").replace(" ", "")
    return hashlib.sha256(normalised.encode()).hexdigest()


def hash_recovery_codes(codes: list[str]) -> list[str]:
    return [_hash_recovery_code(c) for c in codes]


def consume_recovery_code(code: str, hashed_codes: list[str]) -> list[str] | None:
    """Check *code* against *hashed_codes*.

    Returns the updated list (with the matched code removed) on success,
    or ``None`` if the code is not valid.
    """
    h = _hash_recovery_code(code)
    if h not in hashed_codes:
        return None
    updated = [x for x in hashed_codes if x != h]
    return updated
