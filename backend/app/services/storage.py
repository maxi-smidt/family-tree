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
from app.schemas.setting import MediaLimits

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


class UnsupportedImageType(ValueError):
    """Raised when an image upload has an unsupported or unparseable MIME type."""


class ImageTooLarge(ValueError):
    """Raised when an image upload exceeds the configured image limit."""


class InvalidImageURL(ValueError):
    """Raised when an image field contains an external or cross-tree URL."""


def store_document(
    tree_id: str,
    filename: str,
    data_url: str,
    limits: MediaLimits,
) -> tuple[str, str, int]:
    """Persist an attachment from a base64 data URL, unmodified.

    Validates the type against the allowlist (by declared MIME, falling back to
    the user filename's extension) and the configured document size limit.
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

    if len(raw) > limits.max_document_bytes:
        raise FileTooLarge(
            f"File exceeds the {limits.max_document_bytes // (1024 * 1024)} MB limit."
        )

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


def delete_tree_media(tree_id: str) -> None:
    """Best-effort removal of a tree's entire on-disk media directory.

    All of a tree's files (gallery images, story attachments, member photos)
    live under ``media_root/<tree_id>``, so removing that directory cleans them
    up in one shot. Never raises, so a failed cleanup can't break a delete.
    """
    if not tree_id:
        return
    try:
        path = (settings.media_root / tree_id).resolve()
        # Guard against escaping the media root via a malformed tree id.
        if path.parent != settings.media_root.resolve():
            return
        shutil.rmtree(path, ignore_errors=True)
    except OSError:
        pass


def is_data_url(value: str | None) -> bool:
    return isinstance(value, str) and value.startswith("data:")


def store_data_url(tree_id: str, data_url: str, limits: MediaLimits) -> str:
    """Persist a base64 data URL to disk and return its relative media URL.

    Raises ``UnsupportedImageType`` for unknown or unparseable MIME types and
    ``ImageTooLarge`` when the decoded payload exceeds the configured limit.
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
    ext = _MIME_EXT[mime]

    try:
        raw = base64.b64decode(match.group("data"))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 image data") from exc

    if len(raw) > limits.max_image_bytes:
        raise ImageTooLarge(
            f"Image exceeds the {limits.max_image_bytes // (1024 * 1024)} MB limit."
        )

    raw, ext = _normalize_image(raw, ext, limits)

    filename = f"{uuid4().hex}.{ext}"
    (_tree_media_dir(tree_id) / filename).write_bytes(raw)
    return f"{MEDIA_URL_PREFIX}/{tree_id}/{filename}"


def _normalize_image(
    raw: bytes,
    ext: str,
    limits: MediaLimits,
) -> tuple[bytes, str]:
    """Validate dimensions, resize to fit within the display cap, and re-encode as WebP.

    Raises ``UnsupportedImageType`` when Pillow cannot parse the payload or
    either image dimension exceeds the configured limit before resizing.
    """
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(BytesIO(raw)) as img:
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
# inlined with a MIME that ``store_document`` recognizes on re-import.
_EXT_MIME = {**_DOC_EXT_MIME, "avif": "image/avif"}


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
    own_prefix = f"{MEDIA_URL_PREFIX}/{tree_id}/"
    if value.startswith(own_prefix):
        return value
    raise InvalidImageURL(
        "Image field must be null, a data URL, or a media URL owned by this tree"
    )
