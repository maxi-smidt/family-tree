"""Bounded, streaming, authenticated-encrypted archive framing.

A backup archive is a small plaintext header followed by a sequence of
independently authenticated frames: ``4-byte big-endian length`` + AES-256-GCM
ciphertext. Each frame's nonce is the header's random 4-byte prefix plus the
frame's own index in the stream, so no nonce is ever reused and a frame moved
to a different position fails authentication (its ciphertext was bound to a
different nonce). None of this depends on ORM models or the database, so it
can also serve future backup-compatible tooling (see #994, #996).

Frame *content* (which table names are allowed, row/media count budgets,
manifest semantics) is domain logic and lives in ``backup_service``. This
module only guarantees that decoding a frame never requires allocating more
than ``MAX_FRAME_WIRE_BYTES``, regardless of what the file claims — a
corrupted or hostile length prefix is rejected before any read of that size is
attempted.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path, PurePosixPath
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings
from app.services.crypto_export import derive_key

MAGIC = b"FTBK"
STREAM_FORMAT_VERSION = 3
STREAM_FORMAT = "family-tree-instance-backup-stream"

_SALT_LEN = 16
_NONCE_PREFIX_LEN = 4
HEADER_LEN = len(MAGIC) + 1 + _SALT_LEN + _NONCE_PREFIX_LEN

# A single file is read/written in chunks this size, so neither side ever
# holds more than one chunk of media content in memory regardless of the
# file's total size.
MEDIA_CHUNK_BYTES = 4 * 1024 * 1024

# Upper bound on a single frame's ciphertext length, checked against the
# length prefix *before* reading that many bytes. A base64'd MEDIA_CHUNK_BYTES
# chunk plus its JSON envelope comfortably fits; a length prefix claiming more
# than this is rejected outright rather than trusted enough to allocate for.
MAX_FRAME_WIRE_BYTES = 8 * 1024 * 1024


class BackupValidationError(ValueError):
    """Raised when a backup archive is incomplete, corrupt, or incompatible."""


def safe_relative_media_path(path: str) -> PurePosixPath:
    """Return a relative POSIX path, rejecting absolute paths or traversal."""
    relative = PurePosixPath(path)
    if (
        relative.is_absolute()
        or not relative.parts
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        raise BackupValidationError("Backup archive contains an unsafe media path")
    return relative


class ArchiveWriter:
    """Streams frames to *path*, encrypting and fsync'ing as it goes.

    Use as a context manager; call :meth:`close` once all frames are written
    to flush and fsync before the caller does the atomic rename into place.
    Exiting the ``with`` block on an exception just closes the handle — the
    caller owns cleanup of the (still-temporary) file.
    """

    def __init__(self, path: Path):
        self._path = path
        self._file = open(path, "wb")
        self._index = 0
        salt = os.urandom(_SALT_LEN)
        self._nonce_prefix = os.urandom(_NONCE_PREFIX_LEN)
        self._key = derive_key(settings.SECRET_KEY, salt)
        self._file.write(
            MAGIC + bytes([STREAM_FORMAT_VERSION]) + salt + self._nonce_prefix
        )

    def __enter__(self) -> ArchiveWriter:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if not self._file.closed:
            self._file.close()

    def write_frame(self, record: dict[str, Any]) -> None:
        plaintext = json.dumps(record, separators=(",", ":")).encode("utf-8")
        nonce = self._nonce_prefix + self._index.to_bytes(8, "big")
        ciphertext = AESGCM(self._key).encrypt(nonce, plaintext, None)
        if len(ciphertext) > MAX_FRAME_WIRE_BYTES:
            # Not reachable via the bounded writers in backup_service, but
            # guards against a future caller accidentally writing an
            # unbounded frame that the reader would then refuse to open.
            raise BackupValidationError(
                "Backup archive frame exceeds the maximum frame size"
            )
        self._file.write(len(ciphertext).to_bytes(4, "big"))
        self._file.write(ciphertext)
        self._index += 1

    def close(self) -> None:
        self._file.flush()
        os.fsync(self._file.fileno())
        self._file.close()


def iter_archive_frames(path: Path) -> Iterator[dict[str, Any]]:
    """Decrypt and yield frames one at a time, never buffering the whole file.

    Raises :class:`BackupValidationError` on a bad magic/version, wrong key,
    tampered ciphertext, an oversized frame, or a file that ends mid-frame.
    """
    with open(path, "rb") as f:
        header = f.read(HEADER_LEN)
        if len(header) < HEADER_LEN or header[: len(MAGIC)] != MAGIC:
            raise BackupValidationError("Not a recognized backup archive")
        offset = len(MAGIC)
        version = header[offset]
        if version != STREAM_FORMAT_VERSION:
            raise BackupValidationError(f"Unsupported backup archive version {version}")
        offset += 1
        salt = header[offset : offset + _SALT_LEN]
        offset += _SALT_LEN
        nonce_prefix = header[offset : offset + _NONCE_PREFIX_LEN]
        key = derive_key(settings.SECRET_KEY, salt)

        index = 0
        while True:
            length_bytes = f.read(4)
            if not length_bytes:
                break
            if len(length_bytes) != 4:
                raise BackupValidationError("Backup archive is truncated")
            frame_len = int.from_bytes(length_bytes, "big")
            if frame_len <= 0 or frame_len > MAX_FRAME_WIRE_BYTES:
                raise BackupValidationError(
                    "Backup archive frame exceeds the maximum frame size"
                )
            ciphertext = f.read(frame_len)
            if len(ciphertext) != frame_len:
                raise BackupValidationError("Backup archive is truncated")

            nonce = nonce_prefix + index.to_bytes(8, "big")
            try:
                plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
            except InvalidTag as exc:
                raise BackupValidationError("Could not decrypt backup archive") from exc

            try:
                record = json.loads(plaintext.decode("utf-8"))
            except (RecursionError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise BackupValidationError(
                    "Backup archive contains malformed data"
                ) from exc
            if not isinstance(record, dict) or not isinstance(record.get("t"), str):
                raise BackupValidationError("Backup archive contains malformed data")

            index += 1
            yield record
