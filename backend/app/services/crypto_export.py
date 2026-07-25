"""Encrypted export / import of a single tree.

The plaintext is a self-contained JSON bundle (member photos are inlined as
base64 so the file is portable). It is encrypted with AES-256-GCM. The key is
derived with scrypt from a user-supplied password, or — when none is given —
from the server secret (mirroring the old "base encryption" behaviour where an
export is *always* encrypted at rest).
"""

import json
import os
from collections.abc import Mapping

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from app.core.config import settings

MAGIC = b"FTREE1"
FLAG_PASSWORD = 0x01


def _derive_key(secret: str, salt: bytes) -> bytes:
    kdf = Scrypt(salt=salt, length=32, n=2**14, r=8, p=1)
    return kdf.derive(secret.encode("utf-8"))


def encrypt_bundle(bundle: Mapping[str, object], password: str | None) -> bytes:
    plaintext = json.dumps(bundle).encode("utf-8")
    salt = os.urandom(16)
    nonce = os.urandom(12)
    secret = password if password else settings.SECRET_KEY
    key = _derive_key(secret, salt)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, None)
    flags = FLAG_PASSWORD if password else 0
    return MAGIC + bytes([flags]) + salt + nonce + ciphertext


def decrypt_bundle(blob: bytes, password: str | None) -> dict[str, object]:
    if blob[: len(MAGIC)] != MAGIC:
        raise ValueError("Not a Family Tree export file")
    flags = blob[len(MAGIC)]
    offset = len(MAGIC) + 1
    salt = blob[offset : offset + 16]
    nonce = blob[offset + 16 : offset + 28]
    ciphertext = blob[offset + 28 :]

    password_protected = bool(flags & FLAG_PASSWORD)
    if password_protected and not password:
        raise PermissionError("Password required")

    secret = password if password_protected else settings.SECRET_KEY
    key = _derive_key(secret, salt)
    plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
    return json.loads(plaintext.decode("utf-8"))


def is_password_protected(blob: bytes) -> bool:
    if blob[: len(MAGIC)] != MAGIC:
        raise ValueError("Not a Family Tree export file")
    return bool(blob[len(MAGIC)] & FLAG_PASSWORD)
