"""Tests for the minimum-password-length policy (issue #152)."""

from tests.conftest import API, auth, make_user

TOO_SHORT = "abc123"          # 6 chars — below the 8-char minimum
VALID_PW  = "validPass1"      # 10 chars — meets the minimum


# --- Registration -----------------------------------------------------------

def test_register_rejects_short_password(client, db):
    res = client.post(
        f"{API}/auth/register",
        json={"username": "newuser", "password": TOO_SHORT},
    )
    assert res.status_code == 422


def test_register_accepts_valid_password(client, db):
    res = client.post(
        f"{API}/auth/register",
        json={"username": "newuser", "password": VALID_PW},
    )
    # Self-registration is disabled by default in tests, so 403 is the expected
    # business-logic response — the schema validation (422) must NOT trigger.
    assert res.status_code == 403


# --- Admin create user -------------------------------------------------------

def test_admin_create_user_rejects_short_password(client, db):
    admin = make_user(db, "admin", is_admin=True)
    res = client.post(
        f"{API}/users",
        headers=auth(admin),
        json={"username": "bob", "password": TOO_SHORT},
    )
    assert res.status_code == 422


def test_admin_create_user_accepts_valid_password(client, db):
    admin = make_user(db, "admin", is_admin=True)
    res = client.post(
        f"{API}/users",
        headers=auth(admin),
        json={"username": "bob", "password": VALID_PW},
    )
    assert res.status_code == 201


# --- Change password --------------------------------------------------------

def test_change_password_rejects_short_new_password(client, db):
    user = make_user(db, "alice", password="pw123456")
    res = client.post(
        f"{API}/auth/password",
        headers=auth(user),
        json={"current_password": "pw123456", "new_password": TOO_SHORT},
    )
    assert res.status_code == 422


def test_change_password_accepts_valid_new_password(client, db):
    user = make_user(db, "alice", password="pw123456")
    res = client.post(
        f"{API}/auth/password",
        headers=auth(user),
        json={"current_password": "pw123456", "new_password": VALID_PW},
    )
    assert res.status_code == 204


# --- Admin password reset ----------------------------------------------------

def test_password_reset_rejects_short_password(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", password="pw123456")
    res = client.post(
        f"{API}/users/{alice.id}/reset-password",
        headers=auth(admin),
        json={"password": TOO_SHORT},
    )
    assert res.status_code == 422


def test_password_reset_accepts_valid_password(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", password="pw123456")
    res = client.post(
        f"{API}/users/{alice.id}/reset-password",
        headers=auth(admin),
        json={"password": VALID_PW},
    )
    assert res.status_code == 200


# --- Admin patch user password -----------------------------------------------

def test_patch_user_password_rejects_short_password(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", password="pw123456")
    res = client.patch(
        f"{API}/users/{alice.id}",
        headers=auth(admin),
        json={"password": TOO_SHORT},
    )
    assert res.status_code == 422


def test_patch_user_password_accepts_valid_password(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", password="pw123456")
    res = client.patch(
        f"{API}/users/{alice.id}",
        headers=auth(admin),
        json={"password": VALID_PW},
    )
    assert res.status_code == 200
