"""Self-service account profile names and private profile-image coverage."""

import base64

import pytest

from app.core.config import settings
from app.services.storage_usage import compute_owner_usage
from app.services.user_purge import purge_user
from tests.conftest import API, auth, make_user

_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


@pytest.fixture(autouse=True)
def profile_media_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return tmp_path / "media"


def _upload(client, user):
    return client.post(
        f"{API}/auth/profile/image",
        files={"image": ("profile.png", _PNG_BYTES, "image/png")},
        headers=auth(user),
    )


def test_user_can_set_and_clear_profile_names(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")

    updated = client.patch(
        f"{API}/auth/profile",
        json={"first_name": "  Ada ", "last_name": " Lovelace  "},
        headers=auth(alice),
    )

    assert updated.status_code == 200
    assert updated.json()["first_name"] == "Ada"
    assert updated.json()["last_name"] == "Lovelace"
    db.expire_all()
    assert db.get(type(alice), alice.id).first_name == "Ada"

    # The route has no target-user parameter, so Bob can only alter his own row.
    own_update = client.patch(
        f"{API}/auth/profile",
        json={"first_name": "Bob", "last_name": ""},
        headers=auth(bob),
    )
    assert own_update.status_code == 200
    assert own_update.json()["last_name"] is None
    db.expire_all()
    assert db.get(type(alice), alice.id).first_name == "Ada"

    cleared = client.patch(
        f"{API}/auth/profile",
        json={"first_name": "", "last_name": None},
        headers=auth(alice),
    )
    assert cleared.status_code == 200
    assert cleared.json()["first_name"] is None
    assert cleared.json()["last_name"] is None


def test_profile_image_is_private_replaceable_and_removable(
    client, db, profile_media_root
):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")

    first = _upload(client, alice)
    assert first.status_code == 200, first.text
    first_url = first.json()["profile_image_url"]
    assert first_url.startswith(f"{API}/auth/profile/image/")
    assert client.get(first_url, headers=auth(alice)).status_code == 200
    assert client.get(first_url, headers=auth(bob)).status_code == 404

    second = _upload(client, alice)
    assert second.status_code == 200, second.text
    second_url = second.json()["profile_image_url"]
    assert second_url != first_url
    # A prior image cannot be retrieved after replacement.
    assert client.get(first_url, headers=auth(alice)).status_code == 404
    assert client.get(second_url, headers=auth(alice)).status_code == 200

    removed = client.delete(f"{API}/auth/profile/image", headers=auth(alice))
    assert removed.status_code == 200
    assert removed.json()["profile_image_url"] is None
    assert client.get(second_url, headers=auth(alice)).status_code == 404
    assert not [path for path in profile_media_root.rglob("*") if path.is_file()]


def test_profile_image_uses_existing_validation_and_media_quota(client, db):
    alice = make_user(db, "alice")
    alice.media_quota_bytes = 1
    db.commit()

    over_quota = _upload(client, alice)
    assert over_quota.status_code == 413
    assert over_quota.json()["detail"] == "quota_exceeded_media"
    assert db.get(type(alice), alice.id).profile_image is None
    assert compute_owner_usage(db, alice.id)["media_bytes"] == 0

    unsupported = client.post(
        f"{API}/auth/profile/image",
        files={"image": ("profile.pdf", b"not an image", "application/pdf")},
        headers=auth(alice),
    )
    assert unsupported.status_code == 400


def test_profile_media_is_removed_when_user_is_purged(client, db, profile_media_root):
    alice = make_user(db, "alice")
    assert _upload(client, alice).status_code == 200
    assert list(profile_media_root.rglob("*"))

    purge_user(db, alice)

    assert not list(profile_media_root.rglob("*"))
