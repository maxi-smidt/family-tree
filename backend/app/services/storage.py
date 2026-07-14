"""Filesystem-backed media storage for member photos and gallery images.

Gallery images are streamed from the SPA as multipart ``UploadFile`` bytes and
persisted by :func:`store_image_upload`, which keeps transport memory bounded.
The trusted import/export path and the member-photo avatar field still decode
``data:`` URLs via :func:`store_data_url`. Either way the bytes land at
``DATA_PATH/media/<tree_id>/<uuid>.<ext>`` and we hand back a stable, relative
URL (``/api/media/...``) that the browser can use directly in an ``<img src>``.
Filenames are random UUIDs, so the URLs are unguessable.
"""

import base64
import binascii
import hashlib
import os
import re
import shutil
import tempfile
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import settings
from app.schemas.setting import MediaLimits

MEDIA_URL_PREFIX = f"{settings.API_PREFIX}/media"

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


def _safe_tree_dir(tree_id: str, *, create: bool = False) -> Path:
    """Return a canonical direct child of media_root for a safe tree id."""
    if not _SAFE_PATH_SEGMENT_RE.fullmatch(tree_id) or tree_id in {".", ".."}:
        raise ValueError("Invalid tree id for media storage")
    root = settings.media_root.resolve()
    path = (root / tree_id).resolve()
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
    tree_id, filename = parts
    if expected_tree_id is not None and tree_id != expected_tree_id:
        return None
    if (
        not _SAFE_PATH_SEGMENT_RE.fullmatch(tree_id)
        or not _SAFE_PATH_SEGMENT_RE.fullmatch(filename)
        or tree_id in {".", ".."}
        or filename in {".", ".."}
    ):
        return None
    try:
        tree_dir = _safe_tree_dir(tree_id)
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
    tree_id: str,
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
    (_tree_media_dir(tree_id) / stored_name).write_bytes(raw)
    return f"{MEDIA_URL_PREFIX}/{tree_id}/{stored_name}", mime, len(raw)


async def store_document_upload(
    tree_id: str,
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
    tree_dir = _tree_media_dir(tree_id)
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
        return f"{MEDIA_URL_PREFIX}/{tree_id}/{stored_name}", mime, size
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
    _cleanup_upload_temps(
        _DOCUMENT_UPLOAD_TEMP_PREFIX, _DOCUMENT_UPLOAD_TEMP_SUFFIX
    )


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


def _tree_media_dir(tree_id: str) -> Path:
    return _safe_tree_dir(tree_id, create=True)


def _originals_dir(tree_id: str):
    """Return (and create) the ``originals/`` subdirectory for *tree_id*.

    Gallery originals stored in ``"both"`` mode land here as
    ``<uuid>.<ext>`` so they share the same stem as the display WebP in the
    parent directory but are kept in their own namespace.
    """
    tree_dir = _tree_media_dir(tree_id)
    path = (tree_dir / "originals").resolve()
    if path.parent != tree_dir:
        raise ValueError("Invalid originals directory")
    path.mkdir(exist_ok=True)
    return path


def delete_tree_media(tree_id: str) -> None:
    """Best-effort removal of a tree's entire on-disk media directory.

    All of a tree's files (gallery images, story attachments, member photos)
    live under ``media_root/<tree_id>``, so removing that directory cleans them
    up in one shot. Never raises, so a failed cleanup can't break a delete.
    """
    if not tree_id:
        return
    try:
        path = _safe_tree_dir(tree_id)
        shutil.rmtree(path, ignore_errors=True)
    except (OSError, ValueError):
        pass


def is_data_url(value: str | None) -> bool:
    return isinstance(value, str) and value.startswith("data:")


def store_data_url(
    tree_id: str,
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

    tree_dir = _tree_media_dir(tree_id)
    stem = uuid4().hex

    if mode == "original":
        _validate_image_dimensions(raw, limits)
        filename = f"{stem}.{orig_ext}"
        (tree_dir / filename).write_bytes(raw)
        return f"{MEDIA_URL_PREFIX}/{tree_id}/{filename}"

    if mode == "both":
        display_raw, display_ext = _normalize_image(raw, orig_ext, limits)
        display_filename = f"{stem}.{display_ext}"
        (tree_dir / display_filename).write_bytes(display_raw)
        (_originals_dir(tree_id) / f"{stem}.{orig_ext}").write_bytes(raw)
        return f"{MEDIA_URL_PREFIX}/{tree_id}/{display_filename}"

    # Default: "compressed"
    display_raw, display_ext = _normalize_image(raw, orig_ext, limits)
    filename = f"{stem}.{display_ext}"
    (tree_dir / filename).write_bytes(display_raw)
    return f"{MEDIA_URL_PREFIX}/{tree_id}/{filename}"


async def store_image_upload(
    tree_id: str,
    upload: UploadFile,
    limits: MediaLimits,
    *,
    mode: str = "compressed",
) -> str:
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
    """
    mime = (upload.content_type or "").split(";", 1)[0].strip().lower()
    if mime not in _MIME_EXT:
        raise UnsupportedImageType(
            f"Unsupported image type '{mime}'. "
            f"Allowed types: {', '.join(sorted(_MIME_EXT))}."
        )
    orig_ext = _MIME_EXT[mime]
    tree_dir = _tree_media_dir(tree_id)
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

        if mode == "original":
            _validate_image_dimensions(temp_path, limits)
            filename = f"{stem}.{orig_ext}"
            os.replace(temp_path, tree_dir / filename)
            temp_path = None
            return f"{MEDIA_URL_PREFIX}/{tree_id}/{filename}"

        if mode == "both":
            display_raw, display_ext = _normalize_image(temp_path, orig_ext, limits)
            display_filename = f"{stem}.{display_ext}"
            (tree_dir / display_filename).write_bytes(display_raw)
            # Move the streamed original into the originals/ subdir under the
            # same stem, so delete/copy/move helpers keep the pair together.
            os.replace(temp_path, _originals_dir(tree_id) / f"{stem}.{orig_ext}")
            temp_path = None
            return f"{MEDIA_URL_PREFIX}/{tree_id}/{display_filename}"

        # Default: "compressed". The display WebP is a fresh file, so the
        # streamed original temp file is no longer needed — remove it.
        display_raw, display_ext = _normalize_image(temp_path, orig_ext, limits)
        filename = f"{stem}.{display_ext}"
        (tree_dir / filename).write_bytes(display_raw)
        temp_path.unlink(missing_ok=True)
        temp_path = None
        return f"{MEDIA_URL_PREFIX}/{tree_id}/{filename}"
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


def copy_media_to_tree(value: str | None, new_tree_id: str) -> str | None:
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

    Mirrors ``copy_media_to_tree`` but relocates the file (and any
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
    tree_id: str,
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
        return store_data_url(tree_id, value, limits, mode=limits.image_storage_mode)
    if _safe_media_path(value, expected_tree_id=tree_id) is not None:
        return value
    raise InvalidImageURL(
        "Image field must be null, a data URL, or a media URL owned by this tree"
    )


def process_image_field(
    tree_id: str,
    value: str | None,
    limits: MediaLimits,
) -> str | None:
    """Resolve an incoming image field to its persisted form.

    Accepts only:
    - ``None``
    - A ``data:`` URL (written to disk, replaced by its media URL)
    - An existing ``/api/media/<tree_id>/...`` URL owned by the same tree

    Raises ``InvalidImageURL`` for external URLs and cross-tree media refs
    to prevent tracking-pixel injection and data leakage between trees.
    """
    if value is None:
        return None
    if is_data_url(value):
        return store_data_url(tree_id, value, limits)
    if _safe_media_path(value, expected_tree_id=tree_id) is not None:
        return value
    raise InvalidImageURL(
        "Image field must be null, a data URL, or a media URL owned by this tree"
    )
