"""Pydantic models for encrypted full-instance backups.

These models describe the JSON shape that ``app.services.system.backups.backup_service``
encrypts into ``.ftbackup`` files. They replace the previous hand-rolled
``isinstance``/``.get()`` validation with declarative Pydantic validation while
preserving the same rejection semantics.
"""

from __future__ import annotations

import base64
import hashlib
from pathlib import PurePosixPath
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

BACKUP_FORMAT = "family-tree-instance-backup"
BACKUP_VERSION = 2


class UnsafeBackupPathError(ValueError):
    """Raised when a backup contains a media path that leaves the media root."""


def _safe_media_relative(path: str) -> PurePosixPath:
    """Return a relative POSIX path, rejecting absolute or traversal paths."""
    relative = PurePosixPath(path)
    if (
        relative.is_absolute()
        or not relative.parts
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        raise UnsafeBackupPathError("Backup contains an unsafe media path")
    return relative


class MediaItem(BaseModel):
    """One embedded media file inside a backup bundle."""

    path: str
    size_bytes: int = Field(..., ge=0)
    sha256: str
    data: str

    @field_validator("path")
    @classmethod
    def _path_is_safe(cls, value: str) -> str:
        _safe_media_relative(value)
        return value

    @field_validator("data")
    @classmethod
    def _data_is_valid_base64(cls, value: str) -> str:
        try:
            base64.b64decode(value, validate=True)
        except (TypeError, ValueError) as exc:
            raise ValueError("Backup contains invalid media data") from exc
        return value

    @model_validator(mode="after")
    def _hashes_match_decoded_data(self) -> MediaItem:
        raw = base64.b64decode(self.data, validate=True)
        if self.size_bytes != len(raw):
            raise ValueError(f"Backup media size does not match for {self.path}")
        if self.sha256 != hashlib.sha256(raw).hexdigest():
            raise ValueError(f"Backup media hash does not match for {self.path}")
        return self


class ManifestMediaItem(BaseModel):
    """Lightweight media descriptor stored in the backup manifest."""

    path: str
    size_bytes: int = Field(..., ge=0)
    sha256: str


class BackupManifest(BaseModel):
    """The signed, verifiable manifest embedded in every backup."""

    format: Literal["family-tree-instance-backup"]
    version: Literal[2]
    table_row_counts: dict[str, int]
    media: list[ManifestMediaItem]


class BackupBundle(BaseModel):
    """Full instance backup: every restorable row plus embedded media.

    The model validates format, media integrity, and manifest consistency.
    Dynamic checks that depend on the current ``BACKUP_MODELS`` registry
    (exact table-name set and per-table row counts) are performed in
    ``backup_service.validate_bundle`` to avoid a circular import.
    """

    format: Literal["family-tree-instance-backup"]
    version: Literal[2]
    created_at: str
    tables: dict[str, list[dict[str, Any]]]
    media: list[MediaItem]
    manifest: BackupManifest

    @model_validator(mode="after")
    def _manifest_matches_media(self) -> BackupBundle:
        inline_by_path = {item.path: item for item in self.media}
        manifest_by_path = {item.path: item for item in self.manifest.media}

        if len(manifest_by_path) != len(self.manifest.media):
            raise ValueError("Backup manifest contains duplicate media paths")

        if set(inline_by_path) != set(manifest_by_path):
            raise ValueError("Backup media paths do not match manifest")

        for path, inline in inline_by_path.items():
            expected = manifest_by_path[path]
            if inline.size_bytes != expected.size_bytes:
                raise ValueError(f"Backup media size does not match manifest for {path}")
            if inline.sha256 != expected.sha256:
                raise ValueError(f"Backup media hash does not match manifest for {path}")

        return self
