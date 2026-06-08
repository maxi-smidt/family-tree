from app.core.config import settings
from tests.conftest import API, auth, make_user


def test_login_success_and_me(client, db):
    make_user(db, "alice", password="pw123456")
    res = client.post(
        f"{API}/auth/login", json={"username": "alice", "password": "pw123456"}
    )
    assert res.status_code == 200
    token = res.json()["access_token"]

    me = client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "alice"


def test_login_wrong_password(client, db):
    make_user(db, "alice", password="pw123456")
    res = client.post(
        f"{API}/auth/login", json={"username": "alice", "password": "nope"}
    )
    assert res.status_code == 401


def test_login_inactive_account(client, db):
    make_user(db, "alice", password="pw123456", is_active=False)
    res = client.post(
        f"{API}/auth/login", json={"username": "alice", "password": "pw123456"}
    )
    assert res.status_code == 403


def test_login_rate_limited_after_repeated_failures(client, db):
    make_user(db, "alice", password="pw123456")
    for _ in range(settings.LOGIN_MAX_ATTEMPTS):
        bad = client.post(
            f"{API}/auth/login", json={"username": "alice", "password": "bad"}
        )
        assert bad.status_code == 401

    # Even the correct password is now throttled.
    throttled = client.post(
        f"{API}/auth/login", json={"username": "alice", "password": "pw123456"}
    )
    assert throttled.status_code == 429
    assert "Retry-After" in throttled.headers


def test_me_requires_authentication(client):
    assert client.get(f"{API}/auth/me").status_code == 401


def test_change_password(client, db):
    user = make_user(db, "alice", password="pw123456")
    res = client.post(
        f"{API}/auth/password",
        headers=auth(user),
        json={"current_password": "pw123456", "new_password": "newpw789"},
    )
    assert res.status_code == 204

    assert (
        client.post(
            f"{API}/auth/login", json={"username": "alice", "password": "pw123456"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            f"{API}/auth/login", json={"username": "alice", "password": "newpw789"}
        ).status_code
        == 200
    )


def test_admin_can_reset_local_user_password(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", password="pw123456")

    res = client.post(
        f"{API}/users/{alice.id}/reset-password",
        headers=auth(admin),
        json={"password": "reset789"},
    )
    assert res.status_code == 200

    assert (
        client.post(
            f"{API}/auth/login", json={"username": "alice", "password": "pw123456"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            f"{API}/auth/login", json={"username": "alice", "password": "reset789"}
        ).status_code
        == 200
    )


def test_non_admin_cannot_reset_password(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")

    res = client.post(
        f"{API}/users/{bob.id}/reset-password",
        headers=auth(alice),
        json={"password": "reset789"},
    )
    assert res.status_code == 403


def test_admin_cannot_reset_authentik_password(client, db):
    admin = make_user(db, "admin", is_admin=True)
    oidc_user = make_user(db, "oidc-user", password=None)
    oidc_user.auth_provider = "authentik"
    oidc_user.oauth_subject = "authentik|123"
    db.commit()

    res = client.post(
        f"{API}/users/{oidc_user.id}/reset-password",
        headers=auth(admin),
        json={"password": "reset789"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Password reset is only available for local accounts"
