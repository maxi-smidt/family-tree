"""SSE storage.warning events emitted after gallery uploads (issue #416)."""

from unittest.mock import patch

import pytest

from app.core.media_config import MEBIBYTE
from app.services.storage import MEDIA_URL_PREFIX
from tests.conftest import API, auth, make_tree, make_user

_FAKE_MEDIA_URL = f"{MEDIA_URL_PREFIX}tree-id/img.webp"

_CREATE_PAYLOAD = {
    "id": "img-1",
    "image_data": "data:image/png;base64,aW1hZ2U=",
    "uploaded_at": "2024-01-01T00:00:00",
}


@pytest.fixture()
def owner(db):
    return make_user(db, "owner")


@pytest.fixture()
def tree(db, owner):
    return make_tree(db, owner)


def _post_image(client, tree_id, headers):
    return client.post(
        f"{API}/trees/{tree_id}/gallery/images",
        json=_CREATE_PAYLOAD,
        headers=headers,
    )


def test_upload_near_quota_emits_warning(client, db, owner, tree):
    """When media usage >= 90 % of quota after upload, storage.warning is published."""
    owner.media_quota_bytes = 1 * MEBIBYTE
    db.commit()

    with (
        patch(
            "app.api.routes.gallery.process_gallery_image_field",
            return_value=_FAKE_MEDIA_URL,
        ),
        patch("app.api.routes.gallery.event_bus") as mock_bus,
        patch(
            "app.services.storage_usage._media_bytes",
            return_value=int(0.95 * 1 * MEBIBYTE),
        ),
    ):
        res = _post_image(client, tree.id, auth(owner))

    assert res.status_code == 201
    mock_bus.publish.assert_called_once()
    call_args = mock_bus.publish.call_args[0]
    assert call_args[0] == [owner.id]
    assert call_args[1] == "storage.warning"
    assert call_args[2]["tree_id"] == tree.id


def test_upload_below_quota_does_not_emit(client, db, owner, tree):
    """Below the 90 % threshold no warning is published."""
    owner.media_quota_bytes = 100 * MEBIBYTE
    db.commit()

    with (
        patch(
            "app.api.routes.gallery.process_gallery_image_field",
            return_value=_FAKE_MEDIA_URL,
        ),
        patch("app.api.routes.gallery.event_bus") as mock_bus,
        patch(
            "app.services.storage_usage._media_bytes",
            return_value=int(0.5 * 100 * MEBIBYTE),
        ),
    ):
        res = _post_image(client, tree.id, auth(owner))

    assert res.status_code == 201
    mock_bus.publish.assert_not_called()


def test_upload_unlimited_quota_does_not_emit(client, db, owner, tree):
    """When quota is unlimited (0 = unlimited) no warning is published."""
    owner.media_quota_bytes = 0
    db.commit()

    with (
        patch(
            "app.api.routes.gallery.process_gallery_image_field",
            return_value=_FAKE_MEDIA_URL,
        ),
        patch("app.api.routes.gallery.event_bus") as mock_bus,
        patch("app.services.storage_usage._media_bytes", return_value=999_999_999),
    ):
        res = _post_image(client, tree.id, auth(owner))

    assert res.status_code == 201
    mock_bus.publish.assert_not_called()
