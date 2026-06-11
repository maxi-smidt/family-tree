"""Password hashing and JWT helpers."""

from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

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
