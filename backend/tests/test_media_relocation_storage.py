"""Unit tests for ``relocate_workspace_media`` (#995's filesystem half)."""

from app.core.config import settings
from app.services.media.storage import (
    MEDIA_TRASH_DIR_NAME,
    MEDIA_URL_PREFIX,
    relocate_workspace_media,
)

_SRC = "src-tree"
_DEST = "dest-tree"


def _url(workspace_id: str, filename: str) -> str:
    return f"{MEDIA_URL_PREFIX}/{workspace_id}/{filename}"


def test_missing_source_dir_is_a_safe_no_op(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    report = relocate_workspace_media(_SRC, _DEST)
    assert report.url_map == {}
    assert report.files_moved == 0


def test_same_workspace_is_a_no_op(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    src_dir = settings.media_root / _SRC
    src_dir.mkdir(parents=True)
    (src_dir / "a.webp").write_bytes(b"bytes")
    report = relocate_workspace_media(_SRC, _SRC)
    assert report.url_map == {}
    assert (src_dir / "a.webp").is_file()


def test_files_move_and_source_dir_is_removed(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    src_dir = settings.media_root / _SRC
    src_dir.mkdir(parents=True)
    (src_dir / "a.webp").write_bytes(b"photo-a")
    (src_dir / "b.pdf").write_bytes(b"doc-b")

    report = relocate_workspace_media(_SRC, _DEST)

    assert report.files_moved == 2
    assert report.files_deduped == 0
    assert report.bytes_moved == len(b"photo-a") + len(b"doc-b")
    assert report.url_map[_url(_SRC, "a.webp")] == _url(_DEST, "a.webp")
    assert report.url_map[_url(_SRC, "b.pdf")] == _url(_DEST, "b.pdf")
    assert (settings.media_root / _DEST / "a.webp").read_bytes() == b"photo-a"
    assert (settings.media_root / _DEST / "b.pdf").read_bytes() == b"doc-b"
    assert not src_dir.exists()


def test_identical_bytes_are_deduplicated(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    src_dir = settings.media_root / _SRC
    dest_dir = settings.media_root / _DEST
    src_dir.mkdir(parents=True)
    dest_dir.mkdir(parents=True)
    (src_dir / "same.webp").write_bytes(b"identical")
    (dest_dir / "same.webp").write_bytes(b"identical")

    report = relocate_workspace_media(_SRC, _DEST)

    assert report.files_deduped == 1
    assert report.files_renamed == 0
    assert report.bytes_moved == 0
    assert report.url_map[_url(_SRC, "same.webp")] == _url(_DEST, "same.webp")
    assert (dest_dir / "same.webp").read_bytes() == b"identical"


def test_different_bytes_with_same_name_get_a_deterministic_rename(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    src_dir = settings.media_root / _SRC
    dest_dir = settings.media_root / _DEST
    src_dir.mkdir(parents=True)
    dest_dir.mkdir(parents=True)
    (src_dir / "same.webp").write_bytes(b"source-bytes")
    (dest_dir / "same.webp").write_bytes(b"already-there")

    report = relocate_workspace_media(_SRC, _DEST)

    assert report.files_renamed == 1
    new_url = report.url_map[_url(_SRC, "same.webp")]
    assert new_url != _url(_DEST, "same.webp")
    new_name = new_url.rsplit("/", 1)[-1]
    assert (dest_dir / new_name).read_bytes() == b"source-bytes"
    # Both files survive: neither was overwritten or lost.
    assert (dest_dir / "same.webp").read_bytes() == b"already-there"

    # Replaying with the same source bytes converges on the same name
    # instead of accumulating a fresh random rename each time.
    src_dir.mkdir(parents=True)
    (src_dir / "same.webp").write_bytes(b"source-bytes")
    second_report = relocate_workspace_media(_SRC, _DEST)
    assert second_report.url_map[_url(_SRC, "same.webp")] == new_url
    assert second_report.files_deduped == 1


def test_trash_and_originals_relocate_alongside_their_primary(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    src_dir = settings.media_root / _SRC
    src_dir.mkdir(parents=True)
    (src_dir / "display.webp").write_bytes(b"display-bytes")
    (src_dir / "originals").mkdir()
    (src_dir / "originals" / "display.png").write_bytes(b"original-bytes")

    trash_dir = src_dir / MEDIA_TRASH_DIR_NAME
    trash_dir.mkdir()
    (trash_dir / "trashed.webp").write_bytes(b"trashed-bytes")
    (trash_dir / "originals").mkdir()
    (trash_dir / "originals" / "trashed.png").write_bytes(b"trashed-original-bytes")

    report = relocate_workspace_media(_SRC, _DEST)

    dest_dir = settings.media_root / _DEST
    assert (dest_dir / "display.webp").read_bytes() == b"display-bytes"
    assert (dest_dir / "originals" / "display.png").read_bytes() == b"original-bytes"

    dest_trash = dest_dir / MEDIA_TRASH_DIR_NAME
    assert (dest_trash / "trashed.webp").read_bytes() == b"trashed-bytes"
    assert (dest_trash / "originals" / "trashed.png").read_bytes() == (
        b"trashed-original-bytes"
    )

    # Trashed media keeps referencing its pre-trash, live-style URL (same
    # scheme untrash_media/activity snapshots use) — not a `.trash/`-prefixed
    # one — just with the workspace id swapped.
    assert report.url_map[_url(_SRC, "trashed.webp")] == _url(_DEST, "trashed.webp")
    assert report.url_map[_url(_SRC, "display.webp")] == _url(_DEST, "display.webp")


def test_incomplete_upload_temp_files_are_discarded(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    src_dir = settings.media_root / _SRC
    src_dir.mkdir(parents=True)
    (src_dir / ".image-upload-abc.tmp").write_bytes(b"partial")
    (src_dir / "real.webp").write_bytes(b"real-bytes")

    report = relocate_workspace_media(_SRC, _DEST)

    assert report.files_moved == 1
    assert _url(_SRC, ".image-upload-abc.tmp") not in report.url_map
    dest_dir = settings.media_root / _DEST
    assert not list(dest_dir.glob(".image-upload-*"))
    assert (dest_dir / "real.webp").read_bytes() == b"real-bytes"
