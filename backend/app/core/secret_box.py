"""Encryption at rest for small secrets the server must read back later.

Used for credentials people hand to the server for outgoing calls, such as
the API key of their AI provider (#1123). Unlike passwords these cannot be
hashed: the server has to send them on.

Each value is sealed with AES-256-GCM under a key derived (HKDF-SHA256) from
``SECRET_KEY`` and a per-purpose label, so the database alone never reveals
it. ``context`` (for example the owning user's id) is bound in as associated
data: a sealed value copied onto another row fails to open. Rotating
``SECRET_KEY`` makes stored values unreadable; callers treat that as "no
secret stored" and ask for it again.
"""

from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

_VERSION = "v1"
_NONCE_BYTES = 12


class SecretUnreadable(ValueError):
    """A sealed value could not be opened (wrong key, context or corrupt)."""


def _key(purpose: str) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=f"family-tree/secret-box/{purpose}".encode(),
    ).derive(settings.SECRET_KEY.encode("utf-8"))


def seal(plaintext: str, *, purpose: str, context: str) -> str:
    """Encrypt *plaintext*; the result is ASCII and safe to store in a column."""
    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = AESGCM(_key(purpose)).encrypt(
        nonce, plaintext.encode("utf-8"), context.encode("utf-8")
    )
    return f"{_VERSION}.{base64.urlsafe_b64encode(nonce + ciphertext).decode('ascii')}"


def unseal(sealed: str, *, purpose: str, context: str) -> str:
    """Decrypt a value produced by :func:`seal` with the same purpose and context."""
    version, _, payload = sealed.partition(".")
    if version != _VERSION or not payload:
        raise SecretUnreadable("Unknown secret format")
    try:
        raw = base64.urlsafe_b64decode(payload.encode("ascii"))
        nonce, ciphertext = raw[:_NONCE_BYTES], raw[_NONCE_BYTES:]
        plaintext = AESGCM(_key(purpose)).decrypt(
            nonce, ciphertext, context.encode("utf-8")
        )
    except (InvalidTag, ValueError) as exc:
        raise SecretUnreadable("Secret could not be decrypted") from exc
    return plaintext.decode("utf-8")
