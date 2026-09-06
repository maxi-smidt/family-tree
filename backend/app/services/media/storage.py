"""Filesystem-backed media storage for member photos and gallery images.

Gallery images are streamed from the SPA as multipart ``UploadFile`` bytes and
persisted by :func:`store_image_upload`, which keeps transport memory bounded.
The trusted import/export path and the member-photo avatar field still decode
``data:`` URLs via :func:`store_data_url`. Either way the bytes land at
``DATA_PATH/media/<workspace_id>/<uuid>.<ext>`` and we hand back a stable, relative
URL (``/api/media/...``) that the browser can use directly in an ``<img src>``.
Filenames are random UUIDs, so the URLs are unguessable.
"""

import base64
import binascii
import errno
import hashlib
import logging
import os
import re
import shutil
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import settings
from app.schemas.setting import MediaLimits

logger = logging.getLogger(__name__)

MEDIA_URL_PREFIX = f"{settings.API_PREFIX}/media"

# Reserved per-tree subdirectory holding trashed (soft-deleted) media pending
# the retention sweep (see trash_media / purge_expired_media_trash below).
# Workspace ids must match _SAFE_PATH_SEGMENT_RE, which forbids a leading dot, so
# this name can never collide with a real tree directory.
MEDIA_TRASH_DIR_NAME = ".trash"

# How long trashed media survives before purge_expired_media_trash reclaims
# it. A plain constant (not an env-configurable Settings field): it is the
# recovery window for the activity-log undo endpoint (see untrash_media and
# docs/ACTIVITY_AUDIT.md) — once it elapses, undo still restores the row but
# the media link comes back dead.
MEDIA_TRASH_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days


def profile_storage_id(user_id: str) -> str:
    """Return the isolated media-directory identifier for a user profile."""
    return f"profile-{user_id}"


_DATA_URL_RE = re.compile(r"^data:(?P<mime>[\w/+.-]+)?;base64,(?P<data>.+)$", re.DOTALL)
_SAFE_PATH_SEGMENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

_MIME_EXT = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
}

# Canonical extension for each allowed MIME type.
_DOC_MIME_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "text/plain": "txt",
    "text/csv": "csv",
    "text/markdown": "md",
    "application/rtf": "rtf",
    "text/rtf": "rtf",
}

# Canonical MIME for each allowed extension (used when the upload declares a
# missing or generic MIME, which browsers often do for Office files).
_DOC_EXT_MIME = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "csv": "text/csv",
    "md": "text/markdown",
    "rtf": "application/rtf",
}


class UnsupportedFileType(ValueError):
    """Raised when an attachment's type is not in the allowlist."""


class FileTooLarge(ValueError):
    """Raised when an attachment exceeds the configured document limit."""


class ChecksumMismatch(ValueError):
    """Raised when a supplied upload checksum does not match its bytes."""


class UnsupportedImageType(ValueError):
    """Raised when an image upload has an unsupported or unparseable MIME type."""


class ImageTooLarge(ValueError):
    """Raised when an image upload exceeds the configured image limit."""


class InvalidImageURL(ValueError):
    """Raised when an image field contains an external or cross-tree URL."""


def _safe_tree_dir(workspace_id: str, *, create: bool = False) -> Path:
    """Return a canonical direct child of media_root for a safe tree id."""
    if not _SAFE_PATH_SEGMENT_RE.fullmatch(workspace_id) or workspace_id in {".", ".."}:
        raise ValueError("Invalid tree id for media storage")
    root = settings.media_root.resolve()
    path = (root / workspace_id).resolve()
    if path.parent != root:
        raise ValueError("Invalid tree id for media storage")
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_media_path(
    value: str | None,
    *,
    expected_tree_id: str | None = None,
) -> Path | None:
    """Resolve a canonical ``/api/media/<tree>/<file>`` URL safely.

    Media URLs intentionally address one direct file in one direct tree
    directory. Encoded or nested path syntax is not decoded or accepted.
    """
    prefix = f"{MEDIA_URL_PREFIX}/"
    if not value or not value.startswith(prefix):
        return None
    relative = value[len(prefix) :]
    if "\\" in relative:
        return None
    parts = relative.split("/")
    if len(parts) != 2:
        return None
    workspace_id, filename = parts
    if expected_tree_id is not None and workspace_id != expected_tree_id:
        return None
    if (
        not _SAFE_PATH_SEGMENT_RE.fullmatch(workspace_id)
        or not _SAFE_PATH_SEGMENT_RE.fullmatch(filename)
        or workspace_id in {".", ".."}
        or filename in {".", ".."}
    ):
        return None
    try:
        tree_dir = _safe_tree_dir(workspace_id)
    except ValueError:
        return None
    path = (tree_dir / filename).resolve()
    if path.parent != tree_dir:
        return None
    return path


def _safe_original_files(path: Path) -> list[Path]:
    """Return only canonical, regular original siblings contained in-tree."""
    originals_dir = (path.parent / "originals").resolve()
    if originals_dir.parent != path.parent or not originals_dir.is_dir():
        return []
    files: list[Path] = []
    for candidate in originals_dir.glob(f"{path.stem}.*"):
        resolved = candidate.resolve()
        if resolved.parent == originals_dir and resolved.is_file():
            files.append(resolved)
    return files


_DOCUMENT_UPLOAD_CHUNK_SIZE = 1024 * 1024
_DOCUMENT_UPLOAD_TEMP_PREFIX = ".document-upload-"
_DOCUMENT_UPLOAD_TEMP_SUFFIX = ".tmp"

_IMAGE_UPLOAD_CHUNK_SIZE = 1024 * 1024
_IMAGE_UPLOAD_TEMP_PREFIX = ".image-upload-"
_IMAGE_UPLOAD_TEMP_SUFFIX = ".tmp"


def _document_type(filename: str, declared_mime: str | None) -> tuple[str, str]:
    """Return the canonical extension and MIME for an allowed document upload."""
    mime = (declared_mime or "").split(";", 1)[0].strip().lower()
    name_ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if mime in _DOC_MIME_EXT:
        return _DOC_MIME_EXT[mime], mime
    if name_ext in _DOC_EXT_MIME:
        return name_ext, _DOC_EXT_MIME[name_ext]
    raise UnsupportedFileType("Unsupported file type")


def _validate_checksum(checksum: str | None) -> str | None:
    if checksum is None or checksum == "":
        return None
    value = checksum.lower()
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("Checksum must be a SHA-256 hexadecimal digest")
    return value


def store_document(
    workspace_id: str,
    filename: str,
    data_url: str,
    limits: MediaLimits,
) -> tuple[str, str, int]:
    """Persist an attachment decoded from a trusted import/export data URL.

    Browser uploads use :func:`store_document_upload`; this compatibility path
    is only for portable backup imports, whose data URLs are already contained
    in the import archive.
    """
    match = _DATA_URL_RE.match(data_url)
    if not match:
        raise ValueError("Invalid data URL")
    try:
        raw = base64.b64decode(match.group("data"), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 file data") from exc

    ext, mime = _document_type(filename, match.group("mime"))
    if len(raw) > limits.max_document_bytes:
        raise FileTooLarge(
            f"File exceeds the {limits.max_document_bytes // (1024 * 1024)} MB limit."
        )
    stored_name = f"{uuid4().hex}.{ext}"
    (_tree_media_dir(workspace_id) / stored_name).write_bytes(raw)
    return f"{MEDIA_URL_PREFIX}/{workspace_id}/{stored_name}", mime, len(raw)


async def store_document_upload(
    workspace_id: str,
    filename: str,
    upload: UploadFile,
    limits: MediaLimits,
    *,
    checksum: str | None = None,
) -> tuple[str, str, int]:
    """Stream a multipart attachment to an atomic, filesystem-backed file.

    Only one bounded chunk is held while copying the spooled multipart upload.
    The optional SHA-256 checksum is calculated incrementally and verified at
    the end. Any rejection or cancellation removes the temporary file.
    """
    ext, mime = _document_type(filename, upload.content_type)
    expected_checksum = _validate_checksum(checksum)
    stored_name = f"{uuid4().hex}.{ext}"
    tree_dir = _tree_media_dir(workspace_id)
    temp_path: Path | None = None
    digest = hashlib.sha256()
    size = 0

    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=_DOCUMENT_UPLOAD_TEMP_PREFIX,
            suffix=_DOCUMENT_UPLOAD_TEMP_SUFFIX,
            dir=tree_dir,
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            while chunk := await upload.read(_DOCUMENT_UPLOAD_CHUNK_SIZE):
                size += len(chunk)
                if size > limits.max_document_bytes:
                    raise FileTooLarge(
                        "File exceeds the "
                        f"{limits.max_document_bytes // (1024 * 1024)} MB limit."
                    )
                digest.update(chunk)
                temp_file.write(chunk)

        if expected_checksum is not None and digest.hexdigest() != expected_checksum:
            raise ChecksumMismatch("Upload checksum does not match file data")

        os.replace(temp_path, tree_dir / stored_name)
        temp_path = None
        return f"{MEDIA_URL_PREFIX}/{workspace_id}/{stored_name}", mime, size
    except BaseException:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise


def _cleanup_upload_temps(prefix: str, suffix: str) -> None:
    """Remove ``<prefix>*<suffix>`` temp files under every tree's media dir."""
    root = settings.media_root
    if not root.is_dir():
        return
    try:
        tree_dirs = list(root.iterdir())
    except OSError:
        return
    for tree_dir in tree_dirs:
        if not tree_dir.is_dir():
            continue
        for temp_path in tree_dir.glob(f"{prefix}*{suffix}"):
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass


def cleanup_document_upload_temps() -> None:
    """Remove incomplete document-upload files left by an interrupted worker."""
    _cleanup_upload_temps(_DOCUMENT_UPLOAD_TEMP_PREFIX, _DOCUMENT_UPLOAD_TEMP_SUFFIX)


def cleanup_image_upload_temps() -> None:
    """Remove incomplete image-upload files left by an interrupted worker."""
    _cleanup_upload_temps(_IMAGE_UPLOAD_TEMP_PREFIX, _IMAGE_UPLOAD_TEMP_SUFFIX)


def delete_media(value: str | None) -> None:
    """Best-effort removal of the on-disk file backing a media URL.

    Also removes any ``<stem>.orig.*`` sibling written by ``store_data_url``
    in ``"both"`` mode. No-op for non-media URLs or missing files; never
    raises, so a failed cleanup can't break a delete request.
    """
    path = _safe_media_path(value)
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
        # Remove the original stored in the originals/ subdir by "both" mode.
        for orig in _safe_original_files(path):
            orig.unlink(missing_ok=True)
    except OSError:
        pass


def _trash_dir(tree_dir: Path) -> Path:
    path = (tree_dir / MEDIA_TRASH_DIR_NAME).resolve()
    if path.parent != tree_dir:
        raise ValueError("Invalid trash directory")
    path.mkdir(exist_ok=True)
    return path


def _trash_originals_dir(tree_dir: Path) -> Path:
    path = (_trash_dir(tree_dir) / "originals").resolve()
    path.mkdir(exist_ok=True)
    return path


def _stamp_and_trash(src: Path, dest_dir_fn: Callable[[], Path]) -> None:
    """Stamp *src*'s mtime to now, then move it into ``dest_dir_fn()``.

    The mtime is stamped on the source *before* the move so it survives
    either path ``shutil.move`` can take: a same-filesystem ``os.rename``
    carries the source mtime through verbatim, and a cross-filesystem
    ``copy2`` fallback copies it from the source. Stamping only the
    destination (after the move) leaves a window where a stale, already-
    expired mtime sits in trash and can be purged before it's corrected.
    Best-effort and per-file: logs and swallows any failure so one bad file
    can't strand its siblings or break the caller's delete request.
    """
    try:
        dest_dir = dest_dir_fn()
        os.utime(src, None)
        shutil.move(str(src), str(dest_dir / src.name))
    except (OSError, ValueError):
        logger.warning("Failed to trash media file %s", src.name, exc_info=True)


def trash_media(value: str | None) -> None:
    """Move the on-disk file backing a media URL into the tree's trash.

    Retention counterpart to ``delete_media``: instead of unlinking, the file
    (and any ``originals/`` sibling) is moved into ``<tree_dir>/.trash/`` with
    its mtime stamped to the move time, so ``purge_expired_media_trash`` can
    later reclaim it once ``MEDIA_TRASH_TTL_SECONDS`` has elapsed. No-op for
    non-media URLs or missing files; never raises, so a failed move can't
    break a delete request.
    """
    path = _safe_media_path(value)
    if path is None:
        return
    originals = _safe_original_files(path)
    if path.is_file():
        _stamp_and_trash(path, lambda: _trash_dir(path.parent))
    for orig in originals:
        _stamp_and_trash(orig, lambda: _trash_originals_dir(path.parent))


def untrash_media(value: str | None) -> bool:
    """Move a trashed media file back to its live location (issue #762).

    Best-effort inverse of ``trash_media``: given the *original* media URL —
    the same URL a delete snapshot's ``trashed_media`` list records — looks
    for the file under ``<tree_dir>/.trash/`` (and any ``.trash/originals/``
    sibling) and moves it back. Returns True if the primary file was
    restored, False if it was missing, most likely because
    ``purge_expired_media_trash`` already reclaimed it after
    ``MEDIA_TRASH_TTL_SECONDS`` — callers should treat that as a degraded but
    still valid restore (the row comes back with a dead media link) rather
    than an error. Never raises, so a failed move can't break an undo.
    """
    path = _safe_media_path(value)
    if path is None:
        return False
    restored = False
    trashed = _trash_dir(path.parent) / path.name
    if trashed.is_file():
        try:
            shutil.move(str(trashed), str(path))
            restored = True
        except OSError:
            logger.warning("Failed to untrash media file %s", path.name, exc_info=True)
    for candidate in _trash_originals_dir(path.parent).glob(f"{path.stem}.*"):
        if not candidate.is_file():
            continue
        try:
            originals_dir = (path.parent / "originals").resolve()
            originals_dir.mkdir(exist_ok=True)
            shutil.move(str(candidate), str(originals_dir / candidate.name))
        except OSError:
            logger.warning(
                "Failed to untrash original media file %s", candidate.name, exc_info=True
            )
    return restored


def purge_expired_media_trash(ttl_seconds: int = MEDIA_TRASH_TTL_SECONDS) -> int:
    """Permanently remove trashed media files older than ``ttl_seconds``.

    Called from the deletion-sweep loop (``app.services.system.deletion_sweeper``).
    Best-effort per file/tree so one bad entry can't stop the rest. Returns
    the number of files removed.
    """
    root = settings.media_root
    if not root.is_dir():
        return 0
    cutoff = time.time() - ttl_seconds
    removed = 0
    try:
        tree_dirs = list(root.iterdir())
    except OSError:
        return 0
    for tree_dir in tree_dirs:
        trash = tree_dir / MEDIA_TRASH_DIR_NAME
        if not trash.is_dir():
            continue
        try:
            candidates = list(trash.rglob("*"))
        except OSError:
            continue
        for candidate in candidates:
            try:
                if candidate.is_file() and candidate.stat().st_mtime < cutoff:
                    candidate.unlink(missing_ok=True)
                    removed += 1
            except OSError:
                continue
    return removed


def _tree_media_dir(workspace_id: str) -> Path:
    return _safe_tree_dir(workspace_id, create=True)


def _originals_dir(workspace_id: str):
    """Return (and create) the ``originals/`` subdirectory for *workspace_id*.

    Gallery originals stored in ``"both"`` mode land here as
    ``<uuid>.<ext>`` so they share the same stem as the display WebP in the
    parent directory but are kept in their own namespace.
    """
    tree_dir = _tree_media_dir(workspace_id)
    path = (tree_dir / "originals").resolve()
    if path.parent != tree_dir:
        raise ValueError("Invalid originals directory")
    path.mkdir(exist_ok=True)
    return path


def delete_workspace_media(workspace_id: str) -> None:
    """Best-effort removal of a tree's entire on-disk media directory.

    All of a tree's files (gallery images, story attachments, member photos)
    live under ``media_root/<workspace_id>``, so removing that directory cleans them
    up in one shot. Never raises, so a failed cleanup can't break a delete.
    """
    if not workspace_id:
        return
    try:
        path = _safe_tree_dir(workspace_id)
        shutil.rmtree(path, ignore_errors=True)
    except (OSError, ValueError):
        pass


@dataclass
class MediaRelocationReport:
    """Result of merging one workspace's on-disk media into another's
    (migration #995's filesystem half).

    ``url_map`` covers every live and trashed *primary* file (member photos,
    gallery images, document attachments, staged document uploads) — anything
    a persisted media URL could reference — keyed by its pre-relocation URL.
    ``originals/`` siblings move alongside their primary file under whatever
    stem it lands on and are not separately keyed, since nothing references
    them by URL directly (see ``_safe_original_files``).
    """

    url_map: dict[str, str] = field(default_factory=dict)
    files_moved: int = 0
    files_deduped: int = 0
    files_renamed: int = 0
    bytes_moved: int = 0


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fsync_move(src: Path, dest: Path) -> None:
    """Move *src* to *dest*, atomically within *dest*'s directory.

    Tries a same-filesystem ``os.rename`` first (atomic, no data copy — the
    common case, since a source and destination tree both live directly
    under ``media_root``). Falls back to a staged copy+fsync+rename for a
    genuinely cross-device destination, so a crash mid-copy leaves *dest*
    either absent or fully written, never truncated, and *src* untouched.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.rename(src, dest)
        return
    except OSError as exc:
        if exc.errno != errno.EXDEV:
            raise
    fd, tmp_name = tempfile.mkstemp(dir=dest.parent, prefix=".migrate-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as tmp_file, src.open("rb") as src_file:
            shutil.copyfileobj(src_file, tmp_file)
            tmp_file.flush()
            os.fsync(tmp_file.fileno())
        os.replace(tmp_name, dest)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise
    src.unlink(missing_ok=True)


def _is_upload_temp(name: str) -> bool:
    return name.startswith(
        (_DOCUMENT_UPLOAD_TEMP_PREFIX, _IMAGE_UPLOAD_TEMP_PREFIX)
    ) and name.endswith((_DOCUMENT_UPLOAD_TEMP_SUFFIX, _IMAGE_UPLOAD_TEMP_SUFFIX))


def _relocate_one(src: Path, dest_dir: Path) -> tuple[str, bool, int]:
    """Move *src* into *dest_dir*, deduplicating or renaming on collision.

    Returns ``(final_filename, deduped, size)``. A same-named file already at
    the destination with identical bytes is treated as already migrated
    (*src* is simply dropped — ``deduped=True``). A same-named file with
    different bytes never overwrites the destination: *src* is given a
    deterministic, content-derived name instead, so replaying this after a
    crash converges on the same result rather than accumulating random
    renames or losing either file's bytes.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    size = src.stat().st_size
    dest = dest_dir / src.name
    if not dest.exists():
        _fsync_move(src, dest)
        return src.name, False, size

    if _hash_file(dest) == _hash_file(src):
        src.unlink(missing_ok=True)
        return src.name, True, size

    digest = _hash_file(src)
    prefix_len = 12
    while prefix_len <= len(digest):
        candidate = dest_dir / f"{src.stem}-mg{digest[:prefix_len]}{src.suffix}"
        if not candidate.exists():
            _fsync_move(src, candidate)
            return candidate.name, False, size
        if _hash_file(candidate) == digest:
            src.unlink(missing_ok=True)
            return candidate.name, True, size
        prefix_len += 8
    # Practically unreachable (would require a SHA-256 collision), but never
    # silently drop a file: fall back to the full digest as the name.
    candidate = dest_dir / f"{src.stem}-mg{digest}{src.suffix}"
    if candidate.exists():
        src.unlink(missing_ok=True)
        return candidate.name, True, size
    _fsync_move(src, candidate)
    return candidate.name, False, size


def _relocate_original(src: Path, dest_dir: Path, new_stem: str) -> None:
    """Move an ``originals/`` sibling alongside its already-relocated primary
    file, adopting *new_stem* so the pair still shares one stem at the
    destination (see ``_safe_original_files``)."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{new_stem}{src.suffix}"
    if dest.exists():
        if _hash_file(dest) == _hash_file(src):
            src.unlink(missing_ok=True)
            return
        dest = dest_dir / f"{new_stem}-mg{_hash_file(src)[:12]}{src.suffix}"
        if dest.exists():
            src.unlink(missing_ok=True)
            return
    _fsync_move(src, dest)


def relocate_workspace_media(
    source_workspace_id: str,
    target_workspace_id: str,
    *,
    on_file_relocated: Callable[[str, str], None] | None = None,
) -> MediaRelocationReport:
    """Physically merge *source_workspace_id*'s media directory into
    *target_workspace_id*'s.

    Covers live files, their ``originals/`` siblings (gallery ``"both"``
    mode), and the ``.trash/`` retention directory (plus its own
    ``originals/``) — everything under a tree's media directory. Leftover
    incomplete upload-temp files are discarded rather than moved. Safe (and a
    no-op returning an empty report) to call again for a source directory
    that was already fully relocated or never existed, and safe to call
    partway through a prior crashed attempt — see ``_relocate_one``.

    Each individual file is gone from the source the instant it is moved, so
    a caller that needs to survive a crash *between* two files (not just
    before or after the whole directory) must durably record a file's
    old-url -> new-url mapping before the next one moves — ``on_file_relocated``,
    when given, is called with exactly that pair immediately after each
    primary (non-``originals/``) file lands at its destination.
    """
    report = MediaRelocationReport()
    if source_workspace_id == target_workspace_id:
        return report
    try:
        source_dir = _safe_tree_dir(source_workspace_id)
    except ValueError:
        return report
    if not source_dir.is_dir():
        return report
    dest_dir = _tree_media_dir(target_workspace_id)
    url_prefix = f"{MEDIA_URL_PREFIX}/{source_workspace_id}"
    new_url_prefix = f"{MEDIA_URL_PREFIX}/{target_workspace_id}"

    def _move_primary(
        src: Path,
        dest_files_dir: Path,
        originals: list[Path],
        dest_originals_dir: Path,
    ) -> None:
        if _is_upload_temp(src.name):
            src.unlink(missing_ok=True)
            return
        old_url = f"{url_prefix}/{src.name}"
        final_name, deduped, size = _relocate_one(src, dest_files_dir)
        new_url = f"{new_url_prefix}/{final_name}"
        report.url_map[old_url] = new_url
        report.files_moved += 1
        if deduped:
            report.files_deduped += 1
        else:
            report.bytes_moved += size
            if final_name != src.name:
                report.files_renamed += 1
        new_stem = Path(final_name).stem
        for orig in originals:
            _relocate_original(orig, dest_originals_dir, new_stem)
        if on_file_relocated is not None:
            on_file_relocated(old_url, new_url)

    for entry in sorted(source_dir.iterdir(), key=lambda p: p.name):
        if entry.is_file():
            _move_primary(
                entry,
                dest_dir,
                _safe_original_files(entry),
                _originals_dir(target_workspace_id),
            )

    trash_dir = source_dir / MEDIA_TRASH_DIR_NAME
    if trash_dir.is_dir():
        dest_trash_dir = _trash_dir(dest_dir)
        dest_trash_originals_dir = _trash_originals_dir(dest_dir)
        trash_originals_dir = (trash_dir / "originals").resolve()
        for entry in sorted(trash_dir.iterdir(), key=lambda p: p.name):
            if not entry.is_file():
                continue
            originals = (
                list(trash_originals_dir.glob(f"{entry.stem}.*"))
                if trash_originals_dir.is_dir()
                else []
            )
            _move_primary(entry, dest_trash_dir, originals, dest_trash_originals_dir)

    shutil.rmtree(source_dir, ignore_errors=True)
    return report


def _profile_media_url(user_id: str, filename: str) -> str:
    return f"{MEDIA_URL_PREFIX}/{profile_storage_id(user_id)}/{filename}"


async def store_profile_image_upload(
    user_id: str,
    upload: UploadFile,
    limits: MediaLimits,
) -> str:
    """Store a profile image using the standard streamed image safeguards.

    Profile images are always stored as compact WebP display images rather than
    retaining gallery originals. They live in an isolated directory which is
    never exposed by the tree-media route.
    """
    url, _ = await store_image_upload(profile_storage_id(user_id), upload, limits)
    return url.rsplit("/", 1)[-1]


def profile_image_path(user_id: str, filename: str) -> Path | None:
    """Resolve a profile image filename to its canonical private media path."""
    return _safe_media_path(
        _profile_media_url(user_id, filename),
        expected_tree_id=profile_storage_id(user_id),
    )


def delete_profile_image(user_id: str, filename: str | None) -> None:
    """Best-effort cleanup for a user's private profile image."""
    if filename:
        delete_media(_profile_media_url(user_id, filename))


def delete_user_profile_media(user_id: str) -> None:
    """Remove all profile-media files when an account is permanently purged."""
    delete_workspace_media(profile_storage_id(user_id))


def is_data_url(value: str | None) -> bool:
    return isinstance(value, str) and value.startswith("data:")


def store_data_url(
    workspace_id: str,
    data_url: str,
    limits: MediaLimits,
    *,
    mode: str = "compressed",
) -> str:
    """Persist a base64 data URL to disk and return its relative media URL.

    Raises ``UnsupportedImageType`` for unknown or unparseable MIME types and
    ``ImageTooLarge`` when the decoded payload exceeds the configured limit.

    ``mode`` controls how gallery images are stored (gallery router only):
    - ``"compressed"`` (default): resize and re-encode as WebP.
    - ``"original"``: store the raw bytes as-is under their original extension.
    - ``"both"``: store a display WebP *and* keep the original as a sibling
      ``<uuid>.orig.<ext>`` file in the same tree directory.
    """
    match = _DATA_URL_RE.match(data_url)
    if not match:
        raise ValueError("Invalid data URL")

    mime = (match.group("mime") or "").lower()
    if mime not in _MIME_EXT:
        raise UnsupportedImageType(
            f"Unsupported image type '{mime}'. "
            f"Allowed types: {', '.join(sorted(_MIME_EXT))}."
        )
    orig_ext = _MIME_EXT[mime]

    try:
        raw = base64.b64decode(match.group("data"))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 image data") from exc

    if len(raw) > limits.max_image_bytes:
        raise ImageTooLarge(
            f"Image exceeds the {limits.max_image_bytes // (1024 * 1024)} MB limit."
        )

    tree_dir = _tree_media_dir(workspace_id)
    stem = uuid4().hex

    if mode == "original":
        _validate_image_dimensions(raw, limits)
        filename = f"{stem}.{orig_ext}"
        (tree_dir / filename).write_bytes(raw)
        return f"{MEDIA_URL_PREFIX}/{workspace_id}/{filename}"

    if mode == "both":
        display_raw, display_ext = _normalize_image(raw, orig_ext, limits)
        display_filename = f"{stem}.{display_ext}"
        (tree_dir / display_filename).write_bytes(display_raw)
        (_originals_dir(workspace_id) / f"{stem}.{orig_ext}").write_bytes(raw)
        return f"{MEDIA_URL_PREFIX}/{workspace_id}/{display_filename}"

    # Default: "compressed"
    display_raw, display_ext = _normalize_image(raw, orig_ext, limits)
    filename = f"{stem}.{display_ext}"
    (tree_dir / filename).write_bytes(display_raw)
    return f"{MEDIA_URL_PREFIX}/{workspace_id}/{filename}"


async def store_image_upload(
    workspace_id: str,
    upload: UploadFile,
    limits: MediaLimits,
    *,
    mode: str = "compressed",
    extract_exif_date: bool = False,
) -> tuple[str, str | None]:
    """Stream a multipart image upload to disk, normalize it, and store it.

    The browser sends the picked image as multipart ``UploadFile`` bytes rather
    than a base64 ``data:`` URL, so only one bounded chunk is held while the
    body is copied to a temporary file — transport memory stays bounded no
    matter how large the image is. Every existing safeguard is preserved, it
    just reads from the streamed temp file instead of an in-memory payload:
    MIME allowlist, byte-size limit, dimension cap, Pillow decompression-bomb
    protection, WebP re-encode, and the ``image_storage_mode`` branches. Any
    rejection or cancellation removes the temporary file.

    ``mode`` mirrors :func:`store_data_url`:
    - ``"compressed"`` (default): resize + re-encode as WebP.
    - ``"original"``: store the streamed bytes as-is under their extension.
    - ``"both"``: store a display WebP and keep the original as a sibling in
      the ``originals/`` subdirectory.

    Returns ``(media_url, exif_date_taken)``. ``exif_date_taken`` is only ever
    populated when ``extract_exif_date`` is set (gallery uploads want a default
    photo-taken date; other callers like profile avatars don't) and is a
    best-effort ``"YYYY-MM-DD"`` read from the original file's EXIF, or
    ``None`` when absent/unreadable.
    """
    mime = (upload.content_type or "").split(";", 1)[0].strip().lower()
    if mime not in _MIME_EXT:
        raise UnsupportedImageType(
            f"Unsupported image type '{mime}'. "
            f"Allowed types: {', '.join(sorted(_MIME_EXT))}."
        )
    orig_ext = _MIME_EXT[mime]
    tree_dir = _tree_media_dir(workspace_id)
    stem = uuid4().hex
    temp_path: Path | None = None
    size = 0

    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=_IMAGE_UPLOAD_TEMP_PREFIX,
            suffix=_IMAGE_UPLOAD_TEMP_SUFFIX,
            dir=tree_dir,
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            while chunk := await upload.read(_IMAGE_UPLOAD_CHUNK_SIZE):
                size += len(chunk)
                if size > limits.max_image_bytes:
                    raise ImageTooLarge(
                        "Image exceeds the "
                        f"{limits.max_image_bytes // (1024 * 1024)} MB limit."
                    )
                temp_file.write(chunk)

        exif_date_taken = (
            _extract_exif_date_taken(temp_path) if extract_exif_date else None
        )

        if mode == "original":
            _validate_image_dimensions(temp_path, limits)
            filename = f"{stem}.{orig_ext}"
            os.replace(temp_path, tree_dir / filename)
            temp_path = None
            return f"{MEDIA_URL_PREFIX}/{workspace_id}/{filename}", exif_date_taken

        if mode == "both":
            display_raw, display_ext = _normalize_image(temp_path, orig_ext, limits)
            display_filename = f"{stem}.{display_ext}"
            (tree_dir / display_filename).write_bytes(display_raw)
            # Move the streamed original into the originals/ subdir under the
            # same stem, so delete/copy/move helpers keep the pair together.
            os.replace(temp_path, _originals_dir(workspace_id) / f"{stem}.{orig_ext}")
            temp_path = None
            return (
                f"{MEDIA_URL_PREFIX}/{workspace_id}/{display_filename}",
                exif_date_taken,
            )

        # Default: "compressed". The display WebP is a fresh file, so the
        # streamed original temp file is no longer needed — remove it.
        display_raw, display_ext = _normalize_image(temp_path, orig_ext, limits)
        filename = f"{stem}.{display_ext}"
        (tree_dir / filename).write_bytes(display_raw)
        temp_path.unlink(missing_ok=True)
        temp_path = None
        return f"{MEDIA_URL_PREFIX}/{workspace_id}/{filename}", exif_date_taken
    except BaseException:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise


def _open_image_source(source: bytes | Path):
    """Open an image from raw bytes or an on-disk path.

    The streaming upload path passes a temp-file ``Path`` so the encoded bytes
    are read from disk by Pillow instead of held in memory as one base64 copy;
    the trusted import path still passes decoded ``bytes``.
    """
    from PIL import Image

    if isinstance(source, Path):
        return Image.open(source)
    return Image.open(BytesIO(source))


_EXIF_SUBIFD_TAG = 0x8769  # Exif SubIFD pointer, holds DateTimeOriginal/Digitized
_EXIF_DATE_TAGS = (36867, 36868)  # DateTimeOriginal, DateTimeDigitized (Exif SubIFD)
_EXIF_BASE_DATE_TAG = 306  # DateTime (base IFD0) — coarser "file modified" fallback
_EXIF_DATE_RE = re.compile(r"^(\d{4}):(\d{2}):(\d{2})")
_EXIF_YEAR_MIN = 1400
_EXIF_YEAR_MAX_SLACK = 1  # tolerate camera clocks a little ahead of the server


def _extract_exif_date_taken(source: bytes | Path) -> str | None:
    """Best-effort EXIF date-taken lookup; returns ``None`` on any failure.

    Prefers ``DateTimeOriginal``/``DateTimeDigitized`` (Exif SubIFD) over the
    coarser base ``DateTime`` tag, since that's what most cameras and phones
    write. Never raises — corrupt EXIF, an unsupported format, or a garbage
    timestamp must never break or slow down an upload.
    """
    try:
        with _open_image_source(source) as img:
            exif = img.getexif()
            if not exif:
                return None
            raw = None
            try:
                exif_ifd = exif.get_ifd(_EXIF_SUBIFD_TAG)
                for tag in _EXIF_DATE_TAGS:
                    raw = exif_ifd.get(tag)
                    if raw:
                        break
            except Exception:  # noqa: BLE001 - SubIFD access is best-effort
                raw = None
            raw = raw or exif.get(_EXIF_BASE_DATE_TAG)
            if not isinstance(raw, str):
                return None

            match = _EXIF_DATE_RE.match(raw)
            if not match:
                return None
            year, month, day = match.groups()
            year_int, month_int, day_int = int(year), int(month), int(day)
            current_year = date.today().year
            if not (_EXIF_YEAR_MIN <= year_int <= current_year + _EXIF_YEAR_MAX_SLACK):
                return None
            if not (1 <= month_int <= 12) or not (1 <= day_int <= 31):
                return None
            return f"{year}-{month}-{day}"
    except Exception:  # noqa: BLE001 - EXIF extraction is best-effort only
        return None


def _validate_image_dimensions(source: bytes | Path, limits: MediaLimits) -> None:
    """Parse image and reject it if either dimension exceeds the configured cap.

    Raises ``UnsupportedImageType`` when Pillow cannot parse the payload or
    either dimension exceeds ``limits.max_image_dimension``.
    """
    from PIL import UnidentifiedImageError

    try:
        with _open_image_source(source) as img:
            w, h = img.size
            if w > limits.max_image_dimension or h > limits.max_image_dimension:
                raise UnsupportedImageType(
                    f"Image dimensions {w}×{h} exceed the "
                    f"{limits.max_image_dimension}px limit per side."
                )
    except UnsupportedImageType:
        raise
    except UnidentifiedImageError as exc:
        raise UnsupportedImageType("Image data could not be parsed.") from exc
    except Exception as exc:
        raise UnsupportedImageType("Image data could not be processed.") from exc


def _normalize_image(
    source: bytes | Path,
    ext: str,
    limits: MediaLimits,
) -> tuple[bytes, str]:
    """Validate dimensions, resize to fit within the display cap, and re-encode as WebP.

    Raises ``UnsupportedImageType`` when Pillow cannot parse the payload or
    either image dimension exceeds the configured limit before resizing.
    """
    from PIL import UnidentifiedImageError

    try:
        with _open_image_source(source) as img:
            w, h = img.size
            if w > limits.max_image_dimension or h > limits.max_image_dimension:
                raise UnsupportedImageType(
                    f"Image dimensions {w}×{h} exceed the "
                    f"{limits.max_image_dimension}px limit per side."
                )
            img = img.convert("RGB") if img.mode in ("P", "RGBA", "LA") else img
            img.thumbnail((limits.stored_image_width, limits.stored_image_height))
            buffer = BytesIO()
            img.save(buffer, format="WEBP", quality=85)
            return buffer.getvalue(), "webp"
    except UnsupportedImageType:
        raise
    except UnidentifiedImageError as exc:
        raise UnsupportedImageType("Image data could not be parsed.") from exc
    except Exception as exc:
        raise UnsupportedImageType("Image data could not be processed.") from exc


# Document attachment types already cover the common image extensions; only
# avif is image-gallery-specific. Reusing ``_DOC_EXT_MIME`` keeps exports
# inlined with a MIME that the document import path recognizes on re-import.
_EXT_MIME = {**_DOC_EXT_MIME, "avif": "image/avif"}


def media_url_to_data_url(value: str | None) -> str | None:
    """Inline a stored media URL as a base64 data URL (for portable exports).

    Returns the input unchanged when it isn't one of our media URLs, and
    ``None`` if the file is missing.
    """
    if not value or not value.startswith(f"{MEDIA_URL_PREFIX}/"):
        return value
    path = _safe_media_path(value)
    if path is None or not path.is_file():
        return None
    ext = path.suffix.lstrip(".").lower()
    mime = _EXT_MIME.get(ext, "application/octet-stream")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def copy_media_to_workspace(value: str | None, new_tree_id: str) -> str | None:
    """Copy a stored media file into another tree's directory (used by merge).

    Also copies any ``<stem>.orig.*`` sibling (written by ``store_data_url``
    in ``"both"`` mode) under the same new stem. Returns a new media URL, or
    the input unchanged when it isn't one of our media URLs, or ``None`` if
    the source file is missing.
    """
    if not value or not value.startswith(f"{MEDIA_URL_PREFIX}/"):
        return value
    src = _safe_media_path(value)
    if src is None or not src.is_file():
        return None
    ext = src.suffix.lstrip(".") or "bin"
    new_stem = uuid4().hex
    filename = f"{new_stem}.{ext}"
    dest_dir = _tree_media_dir(new_tree_id)
    shutil.copyfile(src, dest_dir / filename)
    # Copy the original stored in the originals/ subdir by "both" mode.
    for orig_src in _safe_original_files(src):
        orig_ext = orig_src.suffix.lstrip(".") or "bin"
        dest = _originals_dir(new_tree_id) / f"{new_stem}.{orig_ext}"
        shutil.copyfile(orig_src, dest)
    return f"{MEDIA_URL_PREFIX}/{new_tree_id}/{filename}"


def move_media_to_tree(value: str | None, new_tree_id: str) -> str | None:
    """Move a stored media file into another tree's directory (subtree move).

    Mirrors ``copy_media_to_workspace`` but relocates the file (and any
    ``originals/`` sibling written by ``store_data_url`` in ``"both"`` mode)
    instead of copying it. Returns the new media URL, the input unchanged when
    it isn't one of our media URLs, or ``None`` if the source file is missing.
    """
    if not value or not value.startswith(f"{MEDIA_URL_PREFIX}/"):
        return value
    src = _safe_media_path(value)
    if src is None or not src.is_file():
        return None
    ext = src.suffix.lstrip(".") or "bin"
    new_stem = uuid4().hex
    filename = f"{new_stem}.{ext}"
    dest_dir = _tree_media_dir(new_tree_id)
    shutil.move(src, dest_dir / filename)
    # Move the original stored in the originals/ subdir by "both" mode.
    for orig_src in _safe_original_files(src):
        orig_ext = orig_src.suffix.lstrip(".") or "bin"
        dest = _originals_dir(new_tree_id) / f"{new_stem}.{orig_ext}"
        shutil.move(orig_src, dest)
    return f"{MEDIA_URL_PREFIX}/{new_tree_id}/{filename}"


def resolve_media_path(value: str | None) -> Path | None:
    """Resolve a stored media URL to its canonical on-disk path, or ``None``
    for a non-media URL or a workspace/filename that fails the safety check.

    A public wrapper around ``_safe_media_path`` for callers outside this
    module that need to verify a reference resolves (e.g. post-relocation
    checks in ``app.services.migration.media``) without reaching into a
    private helper.
    """
    return _safe_media_path(value)


def media_disk_usage(value: str | None) -> int:
    """Total on-disk bytes backing a media URL, including any ``originals/``
    siblings. Returns 0 for non-media URLs and missing files (never raises).
    """
    if not value or not value.startswith(f"{MEDIA_URL_PREFIX}/"):
        return 0
    path = _safe_media_path(value)
    if path is None:
        return 0
    total = 0
    try:
        if path.is_file():
            total += path.stat().st_size
        for orig in _safe_original_files(path):
            total += orig.stat().st_size
    except OSError:
        pass
    return total


def process_gallery_image_field(
    workspace_id: str,
    value: str | None,
    limits: MediaLimits,
) -> str | None:
    """Like ``process_image_field`` but honours ``limits.image_storage_mode``.

    Used exclusively by the gallery router so that originals are only kept for
    gallery images; member photos, story attachments, and exports are unaffected.
    """
    if value is None:
        return None
    if is_data_url(value):
        return store_data_url(workspace_id, value, limits, mode=limits.image_storage_mode)
    if _safe_media_path(value, expected_tree_id=workspace_id) is not None:
        return value
    raise InvalidImageURL(
        "Image field must be null, a data URL, or a media URL owned by this tree"
    )


def process_image_field(
    workspace_id: str,
    value: str | None,
    limits: MediaLimits,
) -> str | None:
    """Resolve an incoming image field to its persisted form.

    Accepts only:
    - ``None``
    - A ``data:`` URL (written to disk, replaced by its media URL)
    - An existing ``/api/media/<workspace_id>/...`` URL owned by the same tree

    Raises ``InvalidImageURL`` for external URLs and cross-tree media refs
    to prevent tracking-pixel injection and data leakage between workspaces.
    """
    if value is None:
        return None
    if is_data_url(value):
        return store_data_url(workspace_id, value, limits)
    if _safe_media_path(value, expected_tree_id=workspace_id) is not None:
        return value
    raise InvalidImageURL(
        "Image field must be null, a data URL, or a media URL owned by this tree"
    )
