"""Tests for tree invitation routes (issue #165)."""

from fastapi.testclient import TestClient

from tests.conftest import API, auth, make_tree, make_user, share


def make_invitation(client: TestClient, tree_id: str, headers: dict, **kwargs) -> dict:
    payload = {"role": "editor", **kwargs}
    r = client.post(f"{API}/trees/{tree_id}/invitations", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Creation + listing
# ---------------------------------------------------------------------------

def test_owner_can_create_invitation(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)
    inv = make_invitation(client, tree.id, auth(alice), role="viewer")

    assert inv["status"] == "pending"
    assert inv["role"] == "viewer"
    assert inv["token"] is not None
    assert len(inv["token"]) > 10


def test_non_owner_cannot_create_invitation(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    share(db, tree, bob, role="editor")

    r = client.post(
        f"{API}/trees/{tree.id}/invitations",
        json={"role": "editor"},
        headers=auth(bob),
    )
    assert r.status_code == 403


def test_stranger_cannot_create_invitation(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)

    r = client.post(
        f"{API}/trees/{tree.id}/invitations",
        json={"role": "editor"},
        headers=auth(bob),
    )
    assert r.status_code == 403


def test_owner_can_list_invitations(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)
    make_invitation(client, tree.id, auth(alice))

    r = client.get(f"{API}/trees/{tree.id}/invitations", headers=auth(alice))
    assert r.status_code == 200
    assert len(r.json()) == 1


# ---------------------------------------------------------------------------
# Accept flow
# ---------------------------------------------------------------------------

def test_accept_invitation_creates_membership(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    inv = make_invitation(client, tree.id, auth(alice), role="editor")
    token = inv["token"]

    r = client.post(f"{API}/invites/{token}/accept", headers=auth(bob))
    assert r.status_code == 200
    body = r.json()
    assert body["tree_id"] == tree.id
    assert body["role"] == "editor"

    # Bob should now have access
    r = client.get(f"{API}/trees/{tree.id}/access", headers=auth(bob))
    assert r.status_code == 200
    members = {m["username"]: m["role"] for m in r.json()}
    assert members["bob"] == "editor"


def test_accept_invitation_is_idempotent(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    inv = make_invitation(client, tree.id, auth(alice))
    token = inv["token"]

    r1 = client.post(f"{API}/invites/{token}/accept", headers=auth(bob))
    assert r1.status_code == 200

    # Second accept fails with 409 (already accepted)
    r2 = client.post(f"{API}/invites/{token}/accept", headers=auth(bob))
    assert r2.status_code == 409


def test_accept_expired_invitation_rejected(client, db):
    from sqlalchemy import select

    from app.models import TreeInvitation

    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    inv_data = make_invitation(client, tree.id, auth(alice), expires_in_days=1)
    token = inv_data["token"]

    # Manually backdate the expiry
    inv = db.scalar(select(TreeInvitation).where(TreeInvitation.token == token))
    inv.expires_at = "2000-01-01T00:00:00+00:00"
    db.commit()

    r = client.post(f"{API}/invites/{token}/accept", headers=auth(bob))
    assert r.status_code == 409


def test_accept_revoked_invitation_rejected(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    inv = make_invitation(client, tree.id, auth(alice))
    token = inv["token"]

    # Revoke it
    r = client.delete(
        f"{API}/trees/{tree.id}/invitations/{inv['id']}", headers=auth(alice)
    )
    assert r.status_code == 204

    r = client.post(f"{API}/invites/{token}/accept", headers=auth(bob))
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Revocation
# ---------------------------------------------------------------------------

def test_revoke_invitation(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)
    inv = make_invitation(client, tree.id, auth(alice))

    r = client.delete(
        f"{API}/trees/{tree.id}/invitations/{inv['id']}", headers=auth(alice)
    )
    assert r.status_code == 204

    # Listing should show status "revoked"
    r = client.get(f"{API}/trees/{tree.id}/invitations", headers=auth(alice))
    assert r.json()[0]["status"] == "revoked"


# ---------------------------------------------------------------------------
# Preview (public endpoint — no auth required)
# ---------------------------------------------------------------------------

def test_invite_preview_does_not_require_auth(client, db):
    alice = make_user(db, "alice")
    tree = make_tree(db, alice)
    inv = make_invitation(client, tree.id, auth(alice), role="viewer")
    token = inv["token"]

    # No Authorization header
    r = client.get(f"{API}/invites/{token}")
    assert r.status_code == 200
    body = r.json()
    assert body["tree_name"] == tree.name
    assert body["role"] == "viewer"
    assert body["valid"] is True
    assert body["requires_account"] is True  # no auth → requires account


def test_invite_preview_invalid_token(client, db):
    r = client.get(f"{API}/invites/nonexistent-token")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Role enforcement — invited viewer cannot write, invited editor can
# ---------------------------------------------------------------------------

def test_invited_viewer_cannot_write(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    inv = make_invitation(client, tree.id, auth(alice), role="viewer")

    client.post(f"{API}/invites/{inv['token']}/accept", headers=auth(bob))

    r = client.post(
        f"{API}/trees/{tree.id}/members",
        json={"id": "m-test-1", "first_name": "Test"},
        headers=auth(bob),
    )
    assert r.status_code == 403


def test_invited_editor_can_write(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    tree = make_tree(db, alice)
    inv = make_invitation(client, tree.id, auth(alice), role="editor")

    client.post(f"{API}/invites/{inv['token']}/accept", headers=auth(bob))

    r = client.post(
        f"{API}/trees/{tree.id}/members",
        json={"id": "m-test-1", "first_name": "Test"},
        headers=auth(bob),
    )
    assert r.status_code == 201
