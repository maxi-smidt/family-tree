"""Unit tests for process_image_field URL validation and image upload limits."""

import base64
import struct
import zlib

import pytest

from app.core.media_config import (
    DEFAULT_MAX_DOCUMENT_UPLOAD_MB,
    DEFAULT_MAX_IMAGE_DIMENSION,
    DEFAULT_MAX_IMAGE_UPLOAD_MB,
    MEBIBYTE,
    STORED_IMAGE_HEIGHT,
    STORED_IMAGE_WIDTH,
)
from app.schemas.setting import MediaLimits
from app.services.storage import (
    MEDIA_URL_PREFIX,
    FileTooLarge,
    ImageTooLarge,
    InvalidImageURL,
    UnsupportedImageType,
    process_image_field,
    store_data_url,
    store_document,
)

_TREE_ID = "tree-abc"
_OTHER_TREE_ID = "tree-xyz"
_LIMITS = MediaLimits(
    max_image_bytes=DEFAULT_MAX_IMAGE_UPLOAD_MB * MEBIBYTE,
    max_image_dimension=DEFAULT_MAX_IMAGE_DIMENSION,
    max_document_bytes=DEFAULT_MAX_DOCUMENT_UPLOAD_MB * MEBIBYTE,
    stored_image_width=STORED_IMAGE_WIDTH,
    stored_image_height=STORED_IMAGE_HEIGHT,
)

# Minimal 1×1 transparent PNG as a data URL for upload tests.
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
_DATA_URL = f"data:image/png;base64,{base64.b64encode(_PNG_BYTES).decode()}"


def test_none_is_allowed():
    assert process_image_field(_TREE_ID, None, _LIMITS) is None


def test_data_url_is_stored(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    result = process_image_field(_TREE_ID, _DATA_URL, _LIMITS)
    assert result is not None
    assert result.startswith(f"{MEDIA_URL_PREFIX}/{_TREE_ID}/")


def test_same_tree_stored_url_is_allowed():
    url = f"{MEDIA_URL_PREFIX}/{_TREE_ID}/abc123.webp"
    assert process_image_field(_TREE_ID, url, _LIMITS) == url


def test_cross_tree_stored_url_is_rejected():
    url = f"{MEDIA_URL_PREFIX}/{_OTHER_TREE_ID}/abc123.webp"
    with pytest.raises(InvalidImageURL):
        process_image_field(_TREE_ID, url, _LIMITS)


def test_external_http_url_is_rejected():
    with pytest.raises(InvalidImageURL):
        process_image_field(
            _TREE_ID,
            "https://example.com/tracking.gif",
            _LIMITS,
        )


def test_external_http_url_without_scheme_is_rejected():
    with pytest.raises(InvalidImageURL):
        process_image_field(_TREE_ID, "//example.com/img.png", _LIMITS)


def test_arbitrary_string_is_rejected():
    with pytest.raises(InvalidImageURL):
        process_image_field(_TREE_ID, "not-a-valid-url", _LIMITS)


# ---------------------------------------------------------------------------
# Image upload validation (issue #149)
# ---------------------------------------------------------------------------


def _make_png(width: int, height: int) -> bytes:
    """Build a minimal valid PNG of the given dimensions."""

    def chunk(name: bytes, data: bytes) -> bytes:
        raw = name + data
        crc = zlib.crc32(raw) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + raw + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw_row = b"\x00" + b"\xff\x00\x00" * width
    raw_rows = raw_row * height
    idat = zlib.compress(raw_rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )


def _data_url(mime: str, data: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def test_default_max_image_bytes_is_documented():
    assert _LIMITS.max_image_bytes == 10 * MEBIBYTE


def test_default_max_image_dimension_is_documented():
    assert _LIMITS.max_image_dimension == 4096


def test_oversized_payload_raises_image_too_large(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    oversized = b"x" * (_LIMITS.max_image_bytes + 1)
    data_url = _data_url("image/png", oversized)
    with pytest.raises(ImageTooLarge):
        store_data_url(_TREE_ID, data_url, _LIMITS)


def test_unsupported_mime_raises_unsupported_image_type():
    data_url = _data_url("application/pdf", b"fake")
    with pytest.raises(UnsupportedImageType):
        store_data_url(_TREE_ID, data_url, _LIMITS)


def test_missing_mime_raises_unsupported_image_type():
    encoded = base64.b64encode(b"fake").decode()
    with pytest.raises(UnsupportedImageType):
        store_data_url(_TREE_ID, f"data:;base64,{encoded}", _LIMITS)


def test_unparseable_image_bytes_raises_unsupported_image_type(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    data_url = _data_url("image/png", b"not-a-real-image")
    with pytest.raises(UnsupportedImageType):
        store_data_url(_TREE_ID, data_url, _LIMITS)


def test_valid_png_is_stored(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(4, 4)
    data_url = _data_url("image/png", png)
    url = store_data_url(_TREE_ID, data_url, _LIMITS)
    assert url.startswith(f"{MEDIA_URL_PREFIX}/{_TREE_ID}/")
    assert url.endswith(".webp")


def test_oversized_dimensions_raises_unsupported_image_type(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(
        _LIMITS.max_image_dimension + 1,
        _LIMITS.max_image_dimension + 1,
    )
    data_url = _data_url("image/png", png)
    with pytest.raises(UnsupportedImageType):
        store_data_url(_TREE_ID, data_url, _LIMITS)


def test_document_limit_uses_supplied_runtime_value(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    limits = _LIMITS.model_copy(update={"max_document_bytes": 3})
    data_url = _data_url("text/plain", b"four")
    with pytest.raises(FileTooLarge, match="File exceeds"):
        store_document(_TREE_ID, "notes.txt", data_url, limits)
