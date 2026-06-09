"""Unit tests for process_image_field URL validation (issue #150)."""

import base64

import pytest

from app.services.storage import (
    MEDIA_URL_PREFIX,
    InvalidImageURL,
    process_image_field,
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
