"""Unit coverage for the low-level bounded/streaming archive framing.

This module has no ORM or database dependency, so these tests cover the
encryption, framing, and truncation/tamper handling in isolation from
``backup_service``'s table/media domain logic (covered in
``test_backup_service.py``).
"""

import pytest

from app.core.config import settings
from app.services.system.backups import streaming_archive as sa


def test_round_trip_writes_and_reads_frames(tmp_path):
    path = tmp_path / "archive.bin"
    frames = [
        {"t": "meta", "format": sa.STREAM_FORMAT, "version": sa.STREAM_FORMAT_VERSION},
        {"t": "row", "table": "members", "rows": [{"id": "m-1"}]},
        {"t": "manifest", "row_count_total": 1},
    ]
    with sa.ArchiveWriter(path) as writer:
        for frame in frames:
            writer.write_frame(frame)
        writer.close()

    assert list(sa.iter_archive_frames(path)) == frames


def test_rejects_wrong_key(tmp_path, monkeypatch):
    path = tmp_path / "archive.bin"
    with sa.ArchiveWriter(path) as writer:
        writer.write_frame({"t": "meta"})
        writer.close()

    monkeypatch.setattr(settings, "SECRET_KEY", "a-completely-different-secret-key-value")
    with pytest.raises(sa.BackupValidationError):
        list(sa.iter_archive_frames(path))


def test_rejects_bad_magic(tmp_path):
    path = tmp_path / "archive.bin"
    path.write_bytes(b"not-an-archive-at-all")
    with pytest.raises(sa.BackupValidationError):
        list(sa.iter_archive_frames(path))


def test_rejects_unsupported_version(tmp_path):
    path = tmp_path / "archive.bin"
    with sa.ArchiveWriter(path) as writer:
        writer.close()
    raw = bytearray(path.read_bytes())
    raw[len(sa.MAGIC)] = sa.STREAM_FORMAT_VERSION + 1
    path.write_bytes(bytes(raw))

    with pytest.raises(sa.BackupValidationError):
        list(sa.iter_archive_frames(path))


@pytest.mark.parametrize(
    "truncate_at",
    [sa.HEADER_LEN + 2, sa.HEADER_LEN + 4 + 2],  # mid length-prefix, mid ciphertext
)
def test_rejects_truncated_file(tmp_path, truncate_at):
    path = tmp_path / "archive.bin"
    with sa.ArchiveWriter(path) as writer:
        writer.write_frame({"t": "meta"})
        writer.close()

    raw = path.read_bytes()
    assert len(raw) > truncate_at
    path.write_bytes(raw[:truncate_at])

    with pytest.raises(sa.BackupValidationError):
        list(sa.iter_archive_frames(path))


def test_truncation_exactly_at_a_frame_boundary_yields_no_frames(tmp_path):
    """A cut between frames looks like a clean end of stream at this layer.

    Detecting that the archive never reached its manifest is
    ``backup_service``'s job (it knows what "complete" means); this module
    only guarantees no *partial* frame is ever accepted.
    """
    path = tmp_path / "archive.bin"
    with sa.ArchiveWriter(path) as writer:
        writer.write_frame({"t": "meta"})
        writer.close()

    path.write_bytes(path.read_bytes()[: sa.HEADER_LEN])
    assert list(sa.iter_archive_frames(path)) == []


def test_rejects_frame_length_prefix_over_the_limit(tmp_path):
    path = tmp_path / "archive.bin"
    with sa.ArchiveWriter(path) as writer:
        writer.close()

    with path.open("ab") as f:
        f.write((sa.MAX_FRAME_WIRE_BYTES + 1).to_bytes(4, "big"))

    with pytest.raises(sa.BackupValidationError):
        list(sa.iter_archive_frames(path))


def test_reordered_frames_fail_authentication(tmp_path):
    """Each frame's nonce is bound to its position, so splicing frame N into
    frame M's slot must fail the GCM tag rather than silently decrypt."""
    path = tmp_path / "archive.bin"
    with sa.ArchiveWriter(path) as writer:
        writer.write_frame({"t": "meta", "n": 0})
        writer.write_frame({"t": "meta", "n": 1})
        writer.close()

    raw = bytearray(path.read_bytes())
    # Both frames have identical plaintext length, so their wire records are
    # the same size and can be swapped by exchanging the two byte ranges
    # after the header.
    body = raw[sa.HEADER_LEN :]
    frame_len = int.from_bytes(body[:4], "big")
    record_size = 4 + frame_len
    first = body[:record_size]
    second = body[record_size : 2 * record_size]
    swapped = bytearray(raw[: sa.HEADER_LEN]) + second + first
    path.write_bytes(bytes(swapped))

    with pytest.raises(sa.BackupValidationError):
        list(sa.iter_archive_frames(path))


@pytest.mark.parametrize(
    "bad_path", ["/etc/passwd", "../escape.txt", "a/../../b.txt", "", "."]
)
def test_safe_relative_media_path_rejects_unsafe_paths(bad_path):
    with pytest.raises(sa.BackupValidationError):
        sa.safe_relative_media_path(bad_path)


def test_safe_relative_media_path_accepts_nested_relative_path():
    result = sa.safe_relative_media_path("tree-1/originals/photo.jpg")
    assert result.parts == ("tree-1", "originals", "photo.jpg")
