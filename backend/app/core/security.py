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

_JWT_ISSUER = "family-tree"
_ACCESS_AUDIENCE = "family-tree-api"
_TOTP_AUDIENCE = "family-tree-totp"
_PUBLIC_TREE_AUDIENCE = "family-tree-public-tree"
_SSE_AUDIENCE = "family-tree-sse"
_NEIGHBORHOOD_AUDIENCE = "family-tree-neighborhood"


def _create_token(
    subject: str,
    *,
    audience: str,
    token_type: str,
    expires_delta: timedelta,
    extra_claims: dict[str, str | int] | None = None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, object] = {
        "sub": subject,
        "iss": _JWT_ISSUER,
        "aud": audience,
        "token_type": token_type,
        "exp": now + expires_delta,
        "iat": now,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _decode_token(token: str, *, audience: str, token_type: str) -> dict:
    payload = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        audience=audience,
        issuer=_JWT_ISSUER,
    )
    if payload.get("token_type") != token_type:
        raise jwt.InvalidTokenError(f"Not a {token_type} token")
    return payload


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
    return _create_token(
        subject,
        audience=_ACCESS_AUDIENCE,
        token_type="access",
        expires_delta=(
            expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        ),
    )


def decode_access_token(token: str) -> dict:
    return _decode_token(token, audience=_ACCESS_AUDIENCE, token_type="access")


# ---------------------------------------------------------------------------
# TOTP session tokens (short-lived JWTs used between the password step and
# the TOTP verification step of a two-factor login).
# ---------------------------------------------------------------------------

_TOTP_SESSION_MINUTES = 5
_TOTP_PHASE_CLAIM = "totp_pending"


def create_totp_session_token(user_id: str) -> str:
    return _create_token(
        user_id,
        audience=_TOTP_AUDIENCE,
        token_type=_TOTP_PHASE_CLAIM,
        expires_delta=timedelta(minutes=_TOTP_SESSION_MINUTES),
    )


def decode_totp_session_token(token: str) -> str:
    """Validate a TOTP session token; return the user id or raise InvalidTokenError."""
    data = _decode_token(token, audience=_TOTP_AUDIENCE, token_type=_TOTP_PHASE_CLAIM)
    return data["sub"]


# ---------------------------------------------------------------------------
# Public-tree unlock tokens (short-lived JWTs proving a visitor entered the
# correct password for a password-protected public tree).
# ---------------------------------------------------------------------------

_PUBLIC_TREE_PHASE = "public_tree"
_PUBLIC_TREE_TOKEN_HOURS = 12


def create_public_tree_token(workspace_id: str, access_version: int) -> str:
    return _create_token(
        workspace_id,
        audience=_PUBLIC_TREE_AUDIENCE,
        token_type=_PUBLIC_TREE_PHASE,
        expires_delta=timedelta(hours=_PUBLIC_TREE_TOKEN_HOURS),
        extra_claims={"access_version": access_version},
    )


def decode_public_tree_token(token: str) -> tuple[str, int]:
    """Validate a public-tree unlock token; return tree id and access version."""
    data = _decode_token(
        token, audience=_PUBLIC_TREE_AUDIENCE, token_type=_PUBLIC_TREE_PHASE
    )
    access_version = data.get("access_version")
    if not isinstance(access_version, int):
        raise jwt.InvalidTokenError("Missing public-tree access version")
    return data["sub"], access_version


# ---------------------------------------------------------------------------
# Neighborhood continuation cursors. Opaque to the client, but signed and
# short-lived so a tampered, expired, or cross-principal cursor is rejected
# rather than replayed against another caller's graph.
# ---------------------------------------------------------------------------

_CURSOR_PHASE = "neighborhood_cursor"
_CURSOR_MINUTES = 30


def create_neighborhood_cursor(workspace_id: str, claims: dict[str, str | int]) -> str:
    return _create_token(
        workspace_id,
        audience=_NEIGHBORHOOD_AUDIENCE,
        token_type=_CURSOR_PHASE,
        expires_delta=timedelta(minutes=_CURSOR_MINUTES),
        extra_claims=claims,
    )


def decode_neighborhood_cursor(token: str) -> dict:
    """Validate a neighborhood cursor; return its claims or raise InvalidTokenError."""
    return _decode_token(token, audience=_NEIGHBORHOOD_AUDIENCE, token_type=_CURSOR_PHASE)


# ---------------------------------------------------------------------------
# SSE tickets. EventSource cannot attach an Authorization header, so the SPA
# exchanges its access token for a one-purpose, one-minute query credential.
# ---------------------------------------------------------------------------

_SSE_TICKET_SECONDS = 60


def create_sse_ticket_token(user_id: str) -> str:
    return _create_token(
        user_id,
        audience=_SSE_AUDIENCE,
        token_type="sse_ticket",
        expires_delta=timedelta(seconds=_SSE_TICKET_SECONDS),
    )


def decode_sse_ticket_token(token: str) -> str:
    data = _decode_token(token, audience=_SSE_AUDIENCE, token_type="sse_ticket")
    return data["sub"]


# ---------------------------------------------------------------------------
# TOTP / recovery-code helpers
# ---------------------------------------------------------------------------

_TOTP_ISSUER = "Family Workspace"
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
