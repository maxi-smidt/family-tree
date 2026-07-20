"""Streamed gallery image uploads (issue #692).

Exercises the multipart ``POST /gallery/images`` route end to end: a happy-path
upload, MIME rejection, and the write-then-verify quota path that must remove
the already-streamed bytes when the tree is over quota. Also covers the
optional/partial photo-taken date and its EXIF-derived default (issue #778).
"""

import base64
from io import BytesIO
from unittest.mock import patch

import pytest
from PIL import Image
from sqlalchemy.exc import IntegrityError

from app.core.media_config import MEBIBYTE
from tests.conftest import API, add_member, auth, make_tree, make_user

# Minimal 1×1 PNG streamed as a multipart gallery upload.
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _jpeg_with_exif_date(date_taken: str | None) -> bytes:
    """A tiny JPEG, optionally carrying an EXIF DateTimeOriginal tag."""
    img = Image.new("RGB", (4, 4), "red")
    buffer = BytesIO()
    if date_taken is None:
        img.save(buffer, format="JPEG")
    else:
        exif = Image.Exif()
        exif.get_ifd(0x8769)[36867] = date_taken  # DateTimeOriginal
        img.save(buffer, format="JPEG", exif=exif.tobytes())
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def _media_root(tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return tmp_path


def _tree_media_files(media_root, tree_id):
    """Persisted (non-temp) files directly under the tree's media dir."""
    tree_dir = media_root / "media" / tree_id
    if not tree_dir.is_dir():
        return []
    return [p for p in tree_dir.iterdir() if p.is_file() and not p.name.startswith(".")]


def _post_image(client, tree_id, headers, *, image=("p.png", _PNG_BYTES, "image/png")):
    return client.post(
        f"{API}/trees/{tree_id}/gallery/images",
        data={"id": "img-1"},
        files={"image": image},
        headers=headers,
    )


def test_streamed_upload_creates_image_and_links(client, db, _media_root):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada", last_name="Doe")

    res = client.post(
        f"{API}/trees/{tree.id}/gallery/images",
        data={"id": "img-1", "title": "A Photo", "member_ids": "m1"},
        files={"image": ("p.png", _PNG_BYTES, "image/png")},
        headers=auth(owner),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["id"] == "img-1"
    # The stored reference is a media URL, never a base64 data URL.
    assert body["imageData"].startswith(f"{API}/media/{tree.id}/")
    assert not body["imageData"].startswith("data:")

    links = client.get(
        f"{API}/trees/{tree.id}/gallery/links", headers=auth(owner)
    ).json()
    assert links == [
        {
            "gallery_image_id": "img-1",
            "member_id": "m1",
            "x": None,
            "y": None,
            "w": None,
            "h": None,
        }
    ]

    # Exactly one persisted image file exists on disk.
    assert len(_tree_media_files(_media_root, tree.id)) == 1


def test_unsupported_type_is_rejected_and_leaves_no_file(client, db, _media_root):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)

    res = _post_image(
        client, tree.id, auth(owner), image=("f.pdf", b"%PDF-1.4 junk", "application/pdf")
    )
    assert res.status_code == 400
    assert _tree_media_files(_media_root, tree.id) == []
    # No leftover streaming temp file either.
    tree_dir = _media_root / "media" / tree.id
    if tree_dir.is_dir():
        assert not list(tree_dir.glob(".image-upload-*.tmp"))


def test_over_quota_upload_deletes_streamed_bytes(client, db, _media_root):
    """Write-then-verify: an over-quota upload removes the bytes it streamed."""
    owner = make_user(db, "owner")
    owner.media_quota_bytes = 1 * MEBIBYTE
    db.commit()
    tree = make_tree(db, owner)

    with patch(
        "app.services.storage_usage._media_bytes",
        return_value=2 * MEBIBYTE,  # already over the 1 MiB quota
    ):
        res = _post_image(client, tree.id, auth(owner))

    assert res.status_code == 413
    # The image row was never created and the streamed bytes were cleaned up.
    assert (
        client.get(f"{API}/trees/{tree.id}/gallery/images", headers=auth(owner)).json()
        == []
    )
    assert _tree_media_files(_media_root, tree.id) == []


def test_duplicate_image_id_deletes_streamed_bytes(client, db, _media_root):
    """A failed flush must not leave the newly streamed media file behind."""
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)

    first = _post_image(client, tree.id, auth(owner))
    assert first.status_code == 201

    with pytest.raises(IntegrityError):
        _post_image(client, tree.id, auth(owner))

    # The original image remains, but the duplicate request's streamed file was
    # deleted when inserting its row failed.
    assert len(_tree_media_files(_media_root, tree.id)) == 1
    tree_dir = _media_root / "media" / tree.id
    assert not list(tree_dir.glob(".image-upload-*.tmp"))


def test_upload_without_date_or_exif_leaves_created_at_null(client, db, _media_root):
    """No client-supplied date and no EXIF data: created_at stays null, not "now"."""
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)

    res = _post_image(client, tree.id, auth(owner))

    assert res.status_code == 201, res.text
    body = res.json()
    assert body["createdAt"] is None
    assert body["uploadedAt"] is not None


def test_upload_defaults_created_at_from_exif_date_taken(client, db, _media_root):
    """An EXIF DateTimeOriginal becomes the default photo-taken date."""
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)

    res = _post_image(
        client,
        tree.id,
        auth(owner),
        image=("p.jpg", _jpeg_with_exif_date("2020:03:15 08:00:00"), "image/jpeg"),
    )

    assert res.status_code == 201, res.text
    assert res.json()["createdAt"] == "2020-03-15"


def test_upload_explicit_created_at_overrides_exif(client, db, _media_root):
    """A client-supplied date wins over any EXIF-derived default."""
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)

    res = client.post(
        f"{API}/trees/{tree.id}/gallery/images",
        data={"id": "img-1", "created_at": "1955"},
        files={
            "image": (
                "p.jpg",
                _jpeg_with_exif_date("2020:03:15 08:00:00"),
                "image/jpeg",
            )
        },
        headers=auth(owner),
    )

    assert res.status_code == 201, res.text
    assert res.json()["createdAt"] == "1955"


def test_upload_ignores_garbage_exif_date(client, db, _media_root):
    """A zeroed-out EXIF timestamp is rejected, leaving created_at null."""
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)

    res = _post_image(
        client,
        tree.id,
        auth(owner),
        image=("p.jpg", _jpeg_with_exif_date("0000:00:00 00:00:00"), "image/jpeg"),
    )

    assert res.status_code == 201, res.text
    assert res.json()["createdAt"] is None


def test_patch_sets_and_clears_created_at(client, db, _media_root):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner)
    _post_image(client, tree.id, auth(owner))

    res = client.patch(
        f"{API}/trees/{tree.id}/gallery/images/img-1",
        json={"createdAt": "1950-06"},
        headers=auth(owner),
    )
    assert res.status_code == 200, res.text
    assert res.json()["createdAt"] == "1950-06"

    res = client.patch(
        f"{API}/trees/{tree.id}/gallery/images/img-1",
        json={"createdAt": None},
        headers=auth(owner),
    )
    assert res.status_code == 200, res.text
    assert res.json()["createdAt"] is None
