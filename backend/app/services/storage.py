"""Filesystem-backed media storage for member photos and gallery images.

Images arrive from the SPA as ``data:`` URLs (base64). We persist the decoded
bytes to ``DATA_PATH/media/<tree_id>/<uuid>.<ext>`` and hand back a stable,
relative URL (``/api/media/...``) that the browser can use directly in an
``<img src>``. Filenames are random UUIDs, so the URLs are unguessable.
"""

import base64
import binascii
import re
import shutil
from io import BytesIO
from uuid import uuid4

from app.core.config import settings

MEDIA_URL_PREFIX = f"{settings.API_PREFIX}/media"

_DATA_URL_RE = re.compile(r"^data:(?P<mime>[\w/+.-]+)?;base64,(?P<data>.+)$", re.DOTALL)

_MIME_EXT = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
}

# --- Document attachments --------------------------------------------------
# Story attachments accept common document/image types and are stored on disk
# unmodified (unlike gallery images, which are normalized to WebP).
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024  # 25 MB

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
    """Raised when an attachment exceeds ``MAX_DOCUMENT_BYTES``."""


def store_document(tree_id: str, filename: str, data_url: str) -> tuple[str, str, int]:
    """Persist an attachment from a base64 data URL, unmodified.

    Validates the type against the allowlist (by declared MIME, falling back to
    the user filename's extension) and the size against ``MAX_DOCUMENT_BYTES``.
    Returns ``(media_url, mime_type, size_bytes)``.
    """
    match = _DATA_URL_RE.match(data_url)
    if not match:
        raise ValueError("Invalid data URL")

    mime = (match.group("mime") or "").lower()
    try:
        raw = base64.b64decode(match.group("data"))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 file data") from exc

    if len(raw) > MAX_DOCUMENT_BYTES:
        raise FileTooLarge("File too large")

    name_ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if mime in _DOC_MIME_EXT:
        ext = _DOC_MIME_EXT[mime]
    elif name_ext in _DOC_EXT_MIME:
        ext = name_ext
    else:
        raise UnsupportedFileType("Unsupported file type")

    # Normalize to a canonical MIME when the upload didn't declare a known one.
    if mime not in _DOC_MIME_EXT:
        mime = _DOC_EXT_MIME.get(ext, "application/octet-stream")

    stored_name = f"{uuid4().hex}.{ext}"
    (_tree_media_dir(tree_id) / stored_name).write_bytes(raw)
    return f"{MEDIA_URL_PREFIX}/{tree_id}/{stored_name}", mime, len(raw)


def delete_media(value: str | None) -> None:
    """Best-effort removal of the on-disk file backing a media URL.

    No-op for non-media URLs or missing files; never raises, so a failed
    cleanup can't break a delete request.
    """
    if not value or not value.startswith(MEDIA_URL_PREFIX):
        return
    rel = value[len(MEDIA_URL_PREFIX) + 1 :]
    try:
        path = (settings.media_root / rel).resolve()
        # Guard against path traversal via a malformed stored URL.
        if settings.media_root.resolve() not in path.parents:
            return
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _tree_media_dir(tree_id: str):
    path = settings.media_root / tree_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def is_data_url(value: str | None) -> bool:
    return isinstance(value, str) and value.startswith("data:")


def store_data_url(tree_id: str, data_url: str) -> str:
    """Persist a base64 data URL to disk and return its relative media URL."""
    match = _DATA_URL_RE.match(data_url)
    if not match:
        raise ValueError("Invalid data URL")

    mime = (match.group("mime") or "image/png").lower()
    ext = _MIME_EXT.get(mime, "bin")
    try:
        raw = base64.b64decode(match.group("data"))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 image data") from exc

    raw, ext = _maybe_normalize(raw, ext)

    filename = f"{uuid4().hex}.{ext}"
    (_tree_media_dir(tree_id) / filename).write_bytes(raw)
    return f"{MEDIA_URL_PREFIX}/{tree_id}/{filename}"


def _maybe_normalize(raw: bytes, ext: str) -> tuple[bytes, str]:
    """Best-effort: validate and bound the image size with Pillow.

    Falls back to the raw bytes if Pillow can't read the payload, so an
    unusual but valid upload is never silently lost.
    """
    try:
        from PIL import Image

        max_w, max_h = 1920, 1080
        with Image.open(BytesIO(raw)) as img:
            img = img.convert("RGB") if img.mode in ("P", "RGBA", "LA") else img
            img.thumbnail((max_w, max_h))
            buffer = BytesIO()
            img.save(buffer, format="WEBP", quality=85)
            return buffer.getvalue(), "webp"
    except Exception:  # noqa: BLE001 - never fail an upload on normalization
        return raw, ext


_EXT_MIME = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
    "avif": "image/avif",
    # Document attachment types, so exports inline them with a MIME that
    # ``store_document`` recognizes on re-import.
    **_DOC_EXT_MIME,
}


def media_url_to_data_url(value: str | None) -> str | None:
    """Inline a stored media URL as a base64 data URL (for portable exports).

    Returns the input unchanged when it isn't one of our media URLs, and
    ``None`` if the file is missing.
    """
    if not value or not value.startswith(MEDIA_URL_PREFIX):
        return value
    rel = value[len(MEDIA_URL_PREFIX) + 1 :]  # strip "/<prefix>/"
    path = settings.media_root / rel
    if not path.is_file():
        return None
    ext = path.suffix.lstrip(".").lower()
    mime = _EXT_MIME.get(ext, "application/octet-stream")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def copy_media_to_tree(value: str | None, new_tree_id: str) -> str | None:
    """Copy a stored media file into another tree's directory (used by merge).

    Returns a new media URL, or the input unchanged when it isn't one of our
    media URLs, or ``None`` if the source file is missing.
    """
    if not value or not value.startswith(MEDIA_URL_PREFIX):
        return value
    rel = value[len(MEDIA_URL_PREFIX) + 1 :]
    src = settings.media_root / rel
    if not src.is_file():
        return None
    ext = src.suffix.lstrip(".") or "bin"
    filename = f"{uuid4().hex}.{ext}"
    dest = _tree_media_dir(new_tree_id) / filename
    shutil.copyfile(src, dest)
    return f"{MEDIA_URL_PREFIX}/{new_tree_id}/{filename}"


def process_image_field(tree_id: str, value: str | None) -> str | None:
    """Resolve an incoming image field to its persisted form.

    - ``None`` stays ``None``.
    - A ``data:`` URL is written to disk and replaced by its media URL.
    - Anything else (an already-stored URL) is returned unchanged.
    """
    if value is None:
        return None
    if is_data_url(value):
        return store_data_url(tree_id, value)
    return value
