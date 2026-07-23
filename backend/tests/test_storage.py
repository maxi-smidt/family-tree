"""Unit tests for process_image_field URL validation and image upload limits."""

import asyncio
import base64
import hashlib
import struct
import time
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
    MEDIA_TRASH_DIR_NAME,
    MEDIA_URL_PREFIX,
    FileTooLarge,
    ImageTooLarge,
    InvalidImageURL,
    UnsupportedImageType,
    cleanup_document_upload_temps,
    cleanup_image_upload_temps,
    copy_media_to_tree,
    delete_media,
    media_disk_usage,
    media_url_to_data_url,
    move_media_to_tree,
    process_image_field,
    purge_expired_media_trash,
    store_data_url,
    store_document,
    store_document_upload,
    store_image_upload,
    trash_media,
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


class ChunkedUpload:
    """Small UploadFile stand-in that yields bounded chunks cooperatively."""

    def __init__(self, filename: str, content_type: str, data: bytes):
        self.filename = filename
        self.content_type = content_type
        self._data = data
        self._offset = 0

    async def read(self, size: int) -> bytes:
        await asyncio.sleep(0)
        if self._offset >= len(self._data):
            return b""
        chunk = self._data[self._offset : self._offset + min(size, 65_536)]
        self._offset += len(chunk)
        return chunk


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


@pytest.mark.parametrize(
    "url",
    [
        f"{MEDIA_URL_PREFIX}/{_TREE_ID}/../../secret.txt",
        f"{MEDIA_URL_PREFIX}/../secret.txt",
        f"{MEDIA_URL_PREFIX}/{_TREE_ID}/nested/file.png",
        f"{MEDIA_URL_PREFIX}/{_TREE_ID}\\..\\secret.txt",
    ],
)
def test_malformed_media_paths_are_rejected(url):
    with pytest.raises(InvalidImageURL):
        process_image_field(_TREE_ID, url, _LIMITS)


def test_media_helpers_cannot_escape_media_root(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    secret = tmp_path / "secret.txt"
    secret.write_text("do not read")
    traversal_url = f"{MEDIA_URL_PREFIX}/../secret.txt"

    assert media_url_to_data_url(traversal_url) is None
    assert copy_media_to_tree(traversal_url, _OTHER_TREE_ID) is None
    assert move_media_to_tree(traversal_url, _OTHER_TREE_ID) is None
    assert media_disk_usage(traversal_url) == 0
    delete_media(traversal_url)
    assert secret.read_text() == "do not read"


def test_media_symlink_outside_tree_is_rejected(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    tree_dir = settings.media_root / _TREE_ID
    tree_dir.mkdir(parents=True)
    secret = tmp_path / "secret.txt"
    secret.write_text("do not read")
    (tree_dir / "linked.txt").symlink_to(secret)
    url = f"{MEDIA_URL_PREFIX}/{_TREE_ID}/linked.txt"

    assert media_url_to_data_url(url) is None
    assert media_disk_usage(url) == 0


def test_originals_symlink_cannot_reach_outside_tree(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    tree_dir = settings.media_root / _TREE_ID
    tree_dir.mkdir(parents=True)
    display = tree_dir / "display.webp"
    display.write_bytes(b"display")
    outside_dir = tmp_path / "outside-originals"
    outside_dir.mkdir()
    outside = outside_dir / "display.png"
    outside.write_bytes(b"private-original")
    (tree_dir / "originals").symlink_to(outside_dir, target_is_directory=True)
    url = f"{MEDIA_URL_PREFIX}/{_TREE_ID}/{display.name}"

    assert media_disk_usage(url) == len(b"display")
    delete_media(url)
    assert outside.read_bytes() == b"private-original"


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


# ---------------------------------------------------------------------------
# image_storage_mode branches
# ---------------------------------------------------------------------------


def test_original_mode_stores_raw_bytes(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    limits = _LIMITS.model_copy(update={"image_storage_mode": "original"})
    png = _make_png(4, 4)
    url = store_data_url(_TREE_ID, _data_url("image/png", png), limits, mode="original")
    assert url.startswith(f"{MEDIA_URL_PREFIX}/{_TREE_ID}/")
    assert url.endswith(".png")
    # Raw bytes are unchanged — no re-encode.
    rel = url[len(MEDIA_URL_PREFIX) + 1:]
    assert (settings.media_root / rel).read_bytes() == png
    # No originals/ subdir created in original-only mode.
    assert not (settings.media_root / _TREE_ID / "originals").exists()


def test_both_mode_writes_display_webp_and_original_subdir(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(4, 4)
    url = store_data_url(_TREE_ID, _data_url("image/png", png), _LIMITS, mode="both")
    assert url.endswith(".webp"), "display URL must be WebP"
    stem = url.rsplit("/", 1)[-1].removesuffix(".webp")
    originals_dir = settings.media_root / _TREE_ID / "originals"
    orig_file = originals_dir / f"{stem}.png"
    assert orig_file.is_file(), "original must be in originals/ subdir"
    assert orig_file.read_bytes() == png, "original bytes must be unchanged"


def test_delete_media_removes_both_display_and_original(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(4, 4)
    url = store_data_url(_TREE_ID, _data_url("image/png", png), _LIMITS, mode="both")
    stem = url.rsplit("/", 1)[-1].removesuffix(".webp")
    orig_file = settings.media_root / _TREE_ID / "originals" / f"{stem}.png"
    assert orig_file.is_file()
    delete_media(url)
    rel = url[len(MEDIA_URL_PREFIX) + 1:]
    assert not (settings.media_root / rel).exists(), "display file must be gone"
    assert not orig_file.exists(), "original must be gone"


def test_trash_media_moves_display_and_original(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(4, 4)
    url = store_data_url(_TREE_ID, _data_url("image/png", png), _LIMITS, mode="both")
    stem = url.rsplit("/", 1)[-1].removesuffix(".webp")
    rel = url[len(MEDIA_URL_PREFIX) + 1 :]
    display_file = settings.media_root / rel
    orig_file = settings.media_root / _TREE_ID / "originals" / f"{stem}.png"
    assert display_file.is_file()
    assert orig_file.is_file()
    display_bytes = display_file.read_bytes()

    trash_media(url)

    assert not display_file.exists(), "display file must be moved out of place"
    assert not orig_file.exists(), "original must be moved out of place"
    trashed_display = (
        settings.media_root / _TREE_ID / MEDIA_TRASH_DIR_NAME / display_file.name
    )
    trashed_orig = (
        settings.media_root
        / _TREE_ID
        / MEDIA_TRASH_DIR_NAME
        / "originals"
        / orig_file.name
    )
    assert trashed_display.is_file()
    assert trashed_display.read_bytes() == display_bytes
    assert trashed_orig.is_file()
    assert trashed_orig.read_bytes() == png


def test_trash_media_moves_original_when_display_missing(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(4, 4)
    url = store_data_url(_TREE_ID, _data_url("image/png", png), _LIMITS, mode="both")
    stem = url.rsplit("/", 1)[-1].removesuffix(".webp")
    rel = url[len(MEDIA_URL_PREFIX) + 1 :]
    display_file = settings.media_root / rel
    orig_file = settings.media_root / _TREE_ID / "originals" / f"{stem}.png"
    assert orig_file.is_file()

    # Simulate the display file already being gone (e.g. a prior partial
    # cleanup); the originals sibling should still be trashed.
    display_file.unlink()

    trash_media(url)

    trashed_orig = (
        settings.media_root
        / _TREE_ID
        / MEDIA_TRASH_DIR_NAME
        / "originals"
        / orig_file.name
    )
    assert trashed_orig.is_file()
    assert trashed_orig.read_bytes() == png
    assert not orig_file.exists()


def test_trash_media_noop_for_missing_file(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    # Never raises for a well-formed but nonexistent media URL.
    trash_media(f"{MEDIA_URL_PREFIX}/{_TREE_ID}/does-not-exist.png")


def test_purge_expired_media_trash_removes_only_expired(tmp_path, monkeypatch):
    import os

    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(4, 4)
    old_url = store_data_url(_TREE_ID, _data_url("image/png", png), _LIMITS)
    fresh_url = store_data_url(_TREE_ID, _data_url("image/png", png), _LIMITS)
    trash_media(old_url)
    trash_media(fresh_url)

    ttl = 60 * 60  # 1 hour
    old_rel = old_url[len(MEDIA_URL_PREFIX) + 1 :]
    old_filename = old_rel.split("/", 1)[1]
    old_trashed = settings.media_root / _TREE_ID / MEDIA_TRASH_DIR_NAME / old_filename
    fresh_rel = fresh_url[len(MEDIA_URL_PREFIX) + 1 :]
    fresh_filename = fresh_rel.split("/", 1)[1]
    fresh_trashed = settings.media_root / _TREE_ID / MEDIA_TRASH_DIR_NAME / fresh_filename

    # Backdate only the "old" file's mtime past the TTL.
    stale_time = time.time() - ttl - 60
    os.utime(old_trashed, (stale_time, stale_time))

    removed = purge_expired_media_trash(ttl)

    assert removed == 1
    assert not old_trashed.exists()
    assert fresh_trashed.exists()


def test_purge_expired_media_trash_no_trash_dir_is_safe(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    assert purge_expired_media_trash(60) == 0


def test_copy_media_to_tree_copies_original_subdir(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(4, 4)
    url = store_data_url(_TREE_ID, _data_url("image/png", png), _LIMITS, mode="both")
    new_url = copy_media_to_tree(url, _OTHER_TREE_ID)
    assert new_url is not None
    new_stem = new_url.rsplit("/", 1)[-1].removesuffix(".webp")
    dest_orig = settings.media_root / _OTHER_TREE_ID / "originals" / f"{new_stem}.png"
    assert dest_orig.is_file(), "original must be copied into new tree's originals/"
    assert dest_orig.read_bytes() == png


def test_document_limit_uses_supplied_runtime_value(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    limits = _LIMITS.model_copy(update={"max_document_bytes": 3})
    data_url = _data_url("text/plain", b"four")
    with pytest.raises(FileTooLarge, match="File exceeds"):
        store_document(_TREE_ID, "notes.txt", data_url, limits)


def test_streamed_documents_are_complete_under_concurrent_near_limit_uploads(
    tmp_path, monkeypatch
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    payload_a = b"a" * (1024 * 1024 - 1)
    payload_b = b"b" * (1024 * 1024 - 1)
    limits = _LIMITS.model_copy(update={"max_document_bytes": 1024 * 1024})

    async def upload_pair():
        return await asyncio.gather(
            store_document_upload(
                _TREE_ID,
                "first.txt",
                ChunkedUpload("first.txt", "text/plain", payload_a),
                limits,
                checksum=hashlib.sha256(payload_a).hexdigest(),
            ),
            store_document_upload(
                _TREE_ID,
                "second.txt",
                ChunkedUpload("second.txt", "text/plain", payload_b),
                limits,
                checksum=hashlib.sha256(payload_b).hexdigest(),
            ),
        )

    uploads = asyncio.run(upload_pair())
    stored = [
        tmp_path / "media" / url.removeprefix(f"{MEDIA_URL_PREFIX}/")
        for url, _, _ in uploads
    ]
    assert [path.read_bytes() for path in stored] == [payload_a, payload_b]
    assert not list((tmp_path / "media" / _TREE_ID).glob(".document-upload-*.tmp"))


def test_streamed_document_rejects_bad_checksum_and_removes_temp_file(
    tmp_path, monkeypatch
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    upload = ChunkedUpload("notes.txt", "text/plain", b"hello")

    with pytest.raises(ValueError, match="checksum"):
        asyncio.run(
            store_document_upload(
                _TREE_ID,
                "notes.txt",
                upload,
                _LIMITS,
                checksum="0" * 64,
            )
        )

    tree_dir = tmp_path / "media" / _TREE_ID
    assert not list(tree_dir.glob(".document-upload-*.tmp"))


def test_startup_cleanup_removes_interrupted_document_uploads(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    tree_dir = tmp_path / "media" / _TREE_ID
    tree_dir.mkdir(parents=True)
    interrupted = tree_dir / ".document-upload-partial.tmp"
    interrupted.write_bytes(b"partial")
    retained = tree_dir / "record.txt"
    retained.write_bytes(b"complete")

    cleanup_document_upload_temps()

    assert not interrupted.exists()
    assert retained.read_bytes() == b"complete"


# ---------------------------------------------------------------------------
# Streamed image uploads (issue #692): no base64 buffering, temp cleanup
# ---------------------------------------------------------------------------


def _image_upload(filename: str, mime: str, data: bytes) -> ChunkedUpload:
    return ChunkedUpload(filename, mime, data)


def test_streamed_image_is_normalized_to_webp(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(8, 8)
    url, _ = asyncio.run(
        store_image_upload(_TREE_ID, _image_upload("p.png", "image/png", png), _LIMITS)
    )
    assert url.startswith(f"{MEDIA_URL_PREFIX}/{_TREE_ID}/")
    assert url.endswith(".webp")
    # The streamed temp file is consumed, never left behind.
    assert not list((tmp_path / "media" / _TREE_ID).glob(".image-upload-*.tmp"))


def test_streamed_image_original_mode_preserves_bytes(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    limits = _LIMITS.model_copy(update={"image_storage_mode": "original"})
    png = _make_png(6, 6)
    url, _ = asyncio.run(
        store_image_upload(
            _TREE_ID, _image_upload("p.png", "image/png", png), limits, mode="original"
        )
    )
    assert url.endswith(".png")
    rel = url[len(MEDIA_URL_PREFIX) + 1 :]
    assert (settings.media_root / rel).read_bytes() == png
    assert not list((tmp_path / "media" / _TREE_ID).glob(".image-upload-*.tmp"))


def test_streamed_image_both_mode_keeps_display_and_original(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(6, 6)
    url, _ = asyncio.run(
        store_image_upload(
            _TREE_ID, _image_upload("p.png", "image/png", png), _LIMITS, mode="both"
        )
    )
    assert url.endswith(".webp")
    stem = url.rsplit("/", 1)[-1].removesuffix(".webp")
    orig = settings.media_root / _TREE_ID / "originals" / f"{stem}.png"
    assert orig.is_file()
    assert orig.read_bytes() == png
    assert not list((tmp_path / "media" / _TREE_ID).glob(".image-upload-*.tmp"))


def test_streamed_oversized_image_rejected_and_temp_removed(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    limits = _LIMITS.model_copy(update={"max_image_bytes": 8})
    with pytest.raises(ImageTooLarge):
        asyncio.run(
            store_image_upload(
                _TREE_ID,
                _image_upload("p.png", "image/png", b"x" * 64),
                limits,
            )
        )
    assert not list((tmp_path / "media" / _TREE_ID).glob(".image-upload-*.tmp"))


def test_streamed_unsupported_mime_rejected(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    with pytest.raises(UnsupportedImageType):
        asyncio.run(
            store_image_upload(
                _TREE_ID,
                _image_upload("doc.pdf", "application/pdf", b"%PDF-1.4"),
                _LIMITS,
            )
        )


def test_streamed_oversized_dimensions_rejected_and_temp_removed(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png = _make_png(
        _LIMITS.max_image_dimension + 1,
        _LIMITS.max_image_dimension + 1,
    )
    with pytest.raises(UnsupportedImageType):
        asyncio.run(
            store_image_upload(
                _TREE_ID, _image_upload("p.png", "image/png", png), _LIMITS
            )
        )
    assert not list((tmp_path / "media" / _TREE_ID).glob(".image-upload-*.tmp"))


def test_streamed_unparseable_image_rejected_and_temp_removed(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    with pytest.raises(UnsupportedImageType):
        asyncio.run(
            store_image_upload(
                _TREE_ID,
                _image_upload("p.png", "image/png", b"not-a-real-image"),
                _LIMITS,
            )
        )
    assert not list((tmp_path / "media" / _TREE_ID).glob(".image-upload-*.tmp"))


def test_streamed_images_complete_under_concurrent_near_limit_uploads(
    tmp_path, monkeypatch
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    png_a = _make_png(4, 4)
    png_b = _make_png(5, 5)
    # The larger image sits exactly on the byte limit — the size guard admits it
    # (only a strictly larger body is rejected), exercising the boundary.
    limits = _LIMITS.model_copy(
        update={
            "max_image_bytes": max(len(png_a), len(png_b)),
            "image_storage_mode": "original",
        }
    )

    async def upload_pair():
        return await asyncio.gather(
            store_image_upload(
                _TREE_ID, _image_upload("a.png", "image/png", png_a), limits,
                mode="original",
            ),
            store_image_upload(
                _TREE_ID, _image_upload("b.png", "image/png", png_b), limits,
                mode="original",
            ),
        )

    (url_a, _), (url_b, _) = asyncio.run(upload_pair())
    stored = {
        (tmp_path / "media" / url.removeprefix(f"{MEDIA_URL_PREFIX}/")).read_bytes()
        for url in (url_a, url_b)
    }
    assert stored == {png_a, png_b}
    assert not list((tmp_path / "media" / _TREE_ID).glob(".image-upload-*.tmp"))


def test_startup_cleanup_removes_interrupted_image_uploads(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    tree_dir = tmp_path / "media" / _TREE_ID
    tree_dir.mkdir(parents=True)
    interrupted = tree_dir / ".image-upload-partial.tmp"
    interrupted.write_bytes(b"partial")
    retained = tree_dir / "keep.webp"
    retained.write_bytes(b"complete")

    cleanup_image_upload_temps()

    assert not interrupted.exists()
    assert retained.read_bytes() == b"complete"
