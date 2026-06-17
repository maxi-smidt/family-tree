"""Tests for per-tree storage usage calculation and quota enforcement."""

import base64

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.storage import _tree_media_dir, delete_tree_media
from app.services.storage_usage import (
    QuotaExceeded,
    _media_bytes,
    _tree_model_bytes,
    check_media_quota,
    check_tree_quota,
    compute_usage,
    owner_quotas,
)
from tests.conftest import API, add_member, auth, make_tree, make_user

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_fake_media(tree_id: str, filename: str, content: bytes) -> str:
    """Write a fake media file and return its path string."""
    path = _tree_media_dir(tree_id) / filename
    path.write_bytes(content)
    return str(path)


def _make_tiny_png_data_url() -> str:
    """Return a minimal 1×1 PNG as a data URL."""
    # 1×1 red PNG (binary-safe minimal PNG)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02"
        b"\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    b64 = base64.b64encode(png_bytes).decode()
    return f"data:image/png;base64,{b64}"


# ---------------------------------------------------------------------------
# _media_bytes
# ---------------------------------------------------------------------------

def test_media_bytes_missing_dir():
    """media_bytes returns 0 when the tree directory doesn't exist."""
    assert _media_bytes("nonexistent-tree-id-xyz") == 0


def test_media_bytes_sums_files(tmp_path, monkeypatch):
    """media_bytes sums file sizes under the tree directory."""
    # media_root is a computed property (DATA_PATH/media) — patch DATA_PATH.
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    tree_id = "test-tree-001"
    _write_fake_media(tree_id, "a.webp", b"hello")
    _write_fake_media(tree_id, "b.webp", b"world!")
    assert _media_bytes(tree_id) == 11  # 5 + 6


def test_media_bytes_zero_after_delete(tmp_path, monkeypatch):
    """media_bytes returns 0 after delete_tree_media removes the directory."""
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    tree_id = "test-tree-002"
    _write_fake_media(tree_id, "photo.webp", b"data")
    assert _media_bytes(tree_id) > 0
    delete_tree_media(tree_id)
    assert _media_bytes(tree_id) == 0


# ---------------------------------------------------------------------------
# _tree_model_bytes / compute_usage
# ---------------------------------------------------------------------------

def test_tree_bytes_grows_with_member(db: Session):
    owner = make_user(db, "storage-owner")
    tree = make_tree(db, owner, "StorageTree")

    before = _tree_model_bytes(db, tree.id)
    add_member(db, tree, "m1", firstName="Alice", lastName="Smith")
    after = _tree_model_bytes(db, tree.id)
    assert after > before


def test_tree_bytes_shrinks_after_delete(db: Session):
    owner = make_user(db, "storage-owner2")
    tree = make_tree(db, owner, "StorageTree2")
    from app.models import Member

    add_member(db, tree, "m2", firstName="Bob", lastName="Jones")
    before = _tree_model_bytes(db, tree.id)
    member = db.get(Member, "m2")
    db.delete(member)
    db.commit()
    after = _tree_model_bytes(db, tree.id)
    assert after < before


def test_compute_usage_shape(db: Session):
    owner = make_user(db, "usage-owner")
    tree = make_tree(db, owner, "UsageTree")
    usage = compute_usage(db, tree.id)
    assert set(usage.keys()) == {"tree_bytes", "media_bytes", "total_bytes"}
    assert usage["total_bytes"] == usage["tree_bytes"] + usage["media_bytes"]


# ---------------------------------------------------------------------------
# GET /trees/{tree_id}/storage endpoint
# ---------------------------------------------------------------------------

def test_storage_endpoint_shape(client: TestClient, db: Session):
    owner = make_user(db, "ep-owner")
    tree = make_tree(db, owner, "EndpointTree")
    resp = client.get(f"{API}/trees/{tree.id}/storage", headers=auth(owner))
    assert resp.status_code == 200
    data = resp.json()
    assert "tree_bytes" in data
    assert "media_bytes" in data
    assert "total_bytes" in data
    assert "tree_quota_bytes" in data
    assert "media_quota_bytes" in data
    assert "total_quota_bytes" in data


def test_storage_endpoint_unlimited_when_no_quota(client: TestClient, db: Session):
    """All quota fields are None (unlimited) when no per-user or instance quota set."""
    owner = make_user(db, "ep-owner2")
    tree = make_tree(db, owner, "EndpointTree2")
    resp = client.get(f"{API}/trees/{tree.id}/storage", headers=auth(owner))
    assert resp.status_code == 200
    data = resp.json()
    assert data["tree_quota_bytes"] is None
    assert data["media_quota_bytes"] is None
    assert data["total_quota_bytes"] is None


def test_storage_endpoint_requires_auth(client: TestClient, db: Session):
    owner = make_user(db, "ep-owner3")
    tree = make_tree(db, owner, "EndpointTree3")
    resp = client.get(f"{API}/trees/{tree.id}/storage")
    assert resp.status_code in (401, 403)


def test_storage_endpoint_shows_quota_when_set(client: TestClient, db: Session):
    owner = make_user(db, "ep-owner4")
    owner.media_quota_bytes = 1024 * 1024  # 1 MB
    db.commit()
    tree = make_tree(db, owner, "EndpointTree4")
    resp = client.get(f"{API}/trees/{tree.id}/storage", headers=auth(owner))
    assert resp.status_code == 200
    data = resp.json()
    assert data["media_quota_bytes"] == 1024 * 1024
    assert data["tree_quota_bytes"] is None  # not set


# ---------------------------------------------------------------------------
# Quota enforcement
# ---------------------------------------------------------------------------

def test_check_media_quota_passes_when_unlimited(db: Session):
    """No exception when quotas are all unlimited (None)."""
    owner = make_user(db, "quota-owner")
    tree = make_tree(db, owner, "QuotaTree")
    # Should not raise
    check_media_quota(db, tree, 999_999_999)


def test_check_media_quota_raises_when_exceeded(db: Session):
    owner = make_user(db, "quota-owner2")
    owner.media_quota_bytes = 100  # 100 bytes
    db.commit()
    tree = make_tree(db, owner, "QuotaTree2")
    with pytest.raises(QuotaExceeded) as exc_info:
        check_media_quota(db, tree, 200)
    assert exc_info.value.bucket == "media"
    assert str(exc_info.value) == "quota_exceeded_media"


def test_check_tree_quota_raises_when_exceeded(db: Session):
    owner = make_user(db, "quota-owner3")
    owner.tree_quota_bytes = 50
    db.commit()
    tree = make_tree(db, owner, "QuotaTree3")
    with pytest.raises(QuotaExceeded) as exc_info:
        check_tree_quota(db, tree, 200)
    assert exc_info.value.bucket == "tree"


def test_check_total_quota_raises_when_exceeded(db: Session):
    owner = make_user(db, "quota-owner4")
    owner.total_quota_bytes = 50
    db.commit()
    tree = make_tree(db, owner, "QuotaTree4")
    # Even if media_quota is unlimited, total cap applies
    with pytest.raises(QuotaExceeded) as exc_info:
        check_media_quota(db, tree, 200)
    assert exc_info.value.bucket == "total"


def test_quota_zero_means_unlimited(db: Session):
    """A per-user quota of 0 means unlimited (not 'deny everything')."""
    owner = make_user(db, "quota-zero-owner")
    owner.media_quota_bytes = 0  # explicit 0 = unlimited
    db.commit()
    tree = make_tree(db, owner, "QuotaZeroTree")
    # Should not raise
    check_media_quota(db, tree, 999_999_999)


# ---------------------------------------------------------------------------
# HTTP 413 enforcement via routes
# ---------------------------------------------------------------------------

def test_create_member_tree_quota_exceeded(client: TestClient, db: Session):
    """Creating a member when tree quota is too small returns 413 with machine code."""
    from uuid import uuid4

    owner = make_user(db, "quota-route-owner", password="secret")
    owner.tree_quota_bytes = 1  # essentially 0 effective (will be exceeded immediately)
    db.commit()
    tree = make_tree(db, owner, "SmallTree")
    resp = client.post(
        f"{API}/trees/{tree.id}/members",
        json={"id": str(uuid4()), "firstName": "Alice"},
        headers=auth(owner),
    )
    assert resp.status_code == 413
    assert resp.json()["detail"] == "quota_exceeded_tree"


def test_create_event_tree_quota_exceeded(client: TestClient, db: Session):
    from uuid import uuid4

    from app.db.base import utcnow_iso

    owner = make_user(db, "quota-event-owner", password="secret")
    owner.tree_quota_bytes = 1
    db.commit()
    tree = make_tree(db, owner, "EventTree")
    resp = client.post(
        f"{API}/trees/{tree.id}/events",
        json={
            "id": str(uuid4()),
            "event_type": "birth",
            "date": "2000-01-01",
            "created_at": utcnow_iso(),
            "member_ids": [],
        },
        headers=auth(owner),
    )
    assert resp.status_code == 413
    assert resp.json()["detail"] == "quota_exceeded_tree"


def test_owner_quotas_returns_none_by_default(db: Session):
    """owner_quotas returns None for all buckets when no quotas are set."""
    owner = make_user(db, "owner-quota-none")
    tree = make_tree(db, owner, "NoneQuotaTree")
    q = owner_quotas(db, tree)
    assert q["tree_quota_bytes"] is None
    assert q["media_quota_bytes"] is None
    assert q["total_quota_bytes"] is None


def test_owner_quotas_editor_uses_owner_quota(db: Session):
    """Quota is enforced based on the tree OWNER, not the acting editor."""
    from tests.conftest import share

    owner = make_user(db, "quota-owner-5")
    owner.tree_quota_bytes = 100
    db.commit()
    editor = make_user(db, "quota-editor-5")
    tree = make_tree(db, owner, "SharedTree")
    share(db, tree, editor, "editor")

    # owner_quotas reads from owner regardless of who's acting
    q = owner_quotas(db, tree)
    assert q["tree_quota_bytes"] == 100


# ---------------------------------------------------------------------------
# Storage consistent after cascade delete
# ---------------------------------------------------------------------------

def test_usage_recomputes_after_tree_delete(db: Session):
    """compute_usage on a deleted tree returns zeros (no rows, no media dir)."""
    owner = make_user(db, "cascade-owner")
    tree = make_tree(db, owner, "CascadeTree")
    add_member(db, tree, "cm1", firstName="Test")
    from app.models import Tree as TreeModel

    usage_before = compute_usage(db, tree.id)
    assert usage_before["tree_bytes"] > 0

    tree_id = tree.id
    db.delete(db.get(TreeModel, tree_id))
    db.commit()
    delete_tree_media(tree_id)

    usage_after = compute_usage(db, tree_id)
    assert usage_after["tree_bytes"] == 0
    assert usage_after["media_bytes"] == 0
