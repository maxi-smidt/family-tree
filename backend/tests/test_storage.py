"""Unit tests for process_image_field URL validation and image upload limits."""

import base64
import struct
import zlib

import pytest

from app.services.storage import (
    MAX_IMAGE_BYTES,
    MAX_IMAGE_DIMENSION,
    MEDIA_URL_PREFIX,
    ImageTooLarge,
    InvalidImageURL,
    UnsupportedImageType,
    process_image_field,
    store_data_url,
)

_TREE_ID = "tree-abc"
_OTHER_TREE_ID = "tree-xyz"

# Minimal 1×1 transparent PNG as a data URL for upload tests.
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
_DATA_URL = f"data:image/png;base64,{base64.b64encode(_PNG_BYTES).decode()}"


def test_none_is_allowed():
    assert process_image_field(_TREE_ID, None) is None


def test_data_url_is_stored(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    result = process_image_field(_TREE_ID, _DATA_URL)
    assert result is not None
    assert result.startswith(f"{MEDIA_URL_PREFIX}/{_TREE_ID}/")


def test_same_tree_stored_url_is_allowed():
    url = f"{MEDIA_URL_PREFIX}/{_TREE_ID}/abc123.webp"
    assert process_image_field(_TREE_ID, url) == url


def test_cross_tree_stored_url_is_rejected():
    url = f"{MEDIA_URL_PREFIX}/{_OTHER_TREE_ID}/abc123.webp"
    with pytest.raises(InvalidImageURL):
        process_image_field(_TREE_ID, url)


def test_external_http_url_is_rejected():
    with pytest.raises(InvalidImageURL):
        process_image_field(_TREE_ID, "https://example.com/tracking.gif")


def test_external_http_url_without_scheme_is_rejected():
    with pytest.raises(InvalidImageURL):
        process_image_field(_TREE_ID, "//example.com/img.png")


def test_arbitrary_string_is_rejected():
    with pytest.raises(InvalidImageURL):
        process_image_field(_TREE_ID, "not-a-valid-url")


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


def test_max_image_bytes_is_documented():
    assert MAX_IMAGE_BYTES == 10 * 1024 * 1024


def test_max_image_dimension_is_documented():
    assert MAX_IMAGE_DIMENSION == 4096


def test_oversized_payload_raises_image_too_large(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    oversized = b"x" * (MAX_IMAGE_BYTES + 1)
    data_url = _data_url("image/png", oversized)
    with pytest.raises(ImageTooLarge):
        store_data_url(_TREE_ID, data_url)


def test_unsupported_mime_raises_unsupported_image_type():
    data_url = _data_url("application/pdf", b"fake")
    with pytest.raises(UnsupportedImageType):
        store_data_url(_TREE_ID, data_url)


def test_missing_mime_raises_unsupported_image_type():
    encoded = base64.b64encode(b"fake").decode()
    with pytest.raises(UnsupportedImageType):
        store_data_url(_TREE_ID, f"data:;base64,{encoded}")


def test_unparseable_image_bytes_raises_unsupported_image_type(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    data_url = _data_url("image/png", b"not-a-real-image")
    with pytest.raises(UnsupportedImageType):
        store_data_url(_TREE_ID, data_url)


def test_valid_png_is_stored(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(4, 4)
    data_url = _data_url("image/png", png)
    url = store_data_url(_TREE_ID, data_url)
    assert url.startswith(f"{MEDIA_URL_PREFIX}/{_TREE_ID}/")
    assert url.endswith(".webp")


def test_oversized_dimensions_raises_unsupported_image_type(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(MAX_IMAGE_DIMENSION + 1, MAX_IMAGE_DIMENSION + 1)
    data_url = _data_url("image/png", png)
    with pytest.raises(UnsupportedImageType):
        store_data_url(_TREE_ID, data_url)
