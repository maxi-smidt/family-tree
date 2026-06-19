"""Tests for typed runtime application settings."""

from app.core.media_config import MEBIBYTE, STORED_IMAGE_HEIGHT, STORED_IMAGE_WIDTH
from app.services.settings_service import get_media_limits, set_setting
from tests.conftest import API, auth, make_user


def test_admin_can_update_media_limits_and_bootstrap_reflects_them(client, db):
    admin = make_user(db, "admin", is_admin=True)

    updated = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={
            "max_image_upload_mb": 12,
            "max_image_dimension": 5000,
            "max_document_upload_mb": 40,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["max_image_upload_mb"] == 12
    assert updated.json()["max_image_dimension"] == 5000
    assert updated.json()["max_document_upload_mb"] == 40

    config = client.get(f"{API}/auth/config")
    assert config.status_code == 200
    assert config.json()["media_limits"] == {
        "max_image_bytes": 12 * MEBIBYTE,
        "max_image_dimension": 5000,
        "max_document_bytes": 40 * MEBIBYTE,
        "stored_image_width": STORED_IMAGE_WIDTH,
        "stored_image_height": STORED_IMAGE_HEIGHT,
        "image_storage_mode": "compressed",
    }


def test_media_limit_updates_are_range_validated(client, db):
    admin = make_user(db, "admin", is_admin=True)
    response = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"max_document_upload_mb": 501},
    )
    assert response.status_code == 422


def test_invalid_stored_media_limit_falls_back_to_default(db):
    set_setting(db, "max_image_upload_mb", "not-an-integer")
    set_setting(db, "max_image_dimension", "999999")
    db.commit()

    limits = get_media_limits(db)
    assert limits.max_image_bytes == 10 * MEBIBYTE
    assert limits.max_image_dimension == 4096
