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
