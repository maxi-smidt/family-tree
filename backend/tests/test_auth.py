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
