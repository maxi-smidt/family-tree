from app.api.routes.oauth import _provision_user
from app.core.config import settings
from app.core.security import _DUMMY_HASH, verify_password
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
    res = client.post(f"{API}/auth/login", json={"username": "alice", "password": "nope"})
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


def test_refresh_renews_an_authenticated_session(client, db):
    user = make_user(db, "alice", password="pw123456")

    res = client.post(f"{API}/auth/refresh", headers=auth(user))

    assert res.status_code == 200
    payload = res.json()
    assert payload["access_token"]
    assert payload["user"]["id"] == user.id


def test_refresh_requires_an_authenticated_session(client):
    assert client.post(f"{API}/auth/refresh").status_code == 401


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
        json={"password": "reset7890"},
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
            f"{API}/auth/login", json={"username": "alice", "password": "reset7890"}
        ).status_code
        == 200
    )


def test_non_admin_cannot_reset_password(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")

    res = client.post(
        f"{API}/users/{bob.id}/reset-password",
        headers=auth(alice),
        json={"password": "reset7890"},
    )
    assert res.status_code == 403


def test_login_unknown_user_returns_generic_401(client):
    """Unknown username must return the same 401 body as a wrong password.

    This verifies that account enumeration via the login endpoint is not
    possible: both "no such user" and "wrong password" produce an identical
    response, preventing attackers from distinguishing between the two cases.
    """
    res = client.post(
        f"{API}/auth/login",
        json={"username": "nobody_here", "password": "doesnotmatter"},
    )
    assert res.status_code == 401
    assert res.json()["detail"] == "Incorrect username or password"


def test_dummy_hash_is_valid_bcrypt_and_never_matches():
    """The _DUMMY_HASH constant must be a structurally valid bcrypt hash.

    verify_password must run without raising and must return False for any
    supplied password, confirming the hash is genuine (full KDF runs) but
    can never authenticate a real user.
    """
    assert _DUMMY_HASH.startswith("$2b$12$")
    assert verify_password("dummy", _DUMMY_HASH) is False
    assert verify_password("anything_else", _DUMMY_HASH) is False


def test_admin_cannot_reset_authentik_password(client, db):
    admin = make_user(db, "admin", is_admin=True)
    oidc_user = make_user(db, "oidc-user", password=None)
    oidc_user.auth_provider = "authentik"
    oidc_user.oauth_subject = "authentik|123"
    db.commit()

    res = client.post(
        f"{API}/users/{oidc_user.id}/reset-password",
        headers=auth(admin),
        json={"password": "reset7890"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Password reset is only available for local accounts"


# --- Authentik admin-group sync tests --------------------------------------


def test_authentik_admin_revoked_when_not_in_group(db):
    """Authentik user loses admin when removed from the admin group."""
    user = make_user(db, "oidc-admin", is_admin=True)
    user.auth_provider = "authentik"
    user.oauth_subject = "authentik|sub-001"
    db.commit()

    # Simulate a login where the user is NOT in the admin group.
    admin_group = settings.AUTHENTIK_ADMIN_GROUP
    userinfo = {
        "sub": "authentik|sub-001",
        "email": "oidc-admin@example.com",
        "preferred_username": "oidc-admin",
        "groups": ["some-other-group"],  # admin group is absent
    }

    assert admin_group not in userinfo["groups"], "precondition: user not in admin group"
    result = _provision_user(db, userinfo)

    assert result is not None
    assert result.is_admin is False, "admin should be revoked after leaving the group"


def test_local_admin_not_affected_by_oidc_login(db):
    """Local admin account retains admin even when matched by email via OIDC."""
    _ = make_user(db, "local-admin", is_admin=True)
    # auth_provider stays "local" — make_user sets it to "local" by default
    db.commit()

    # Simulate an OIDC login that matches by email but carries no admin group.
    userinfo = {
        "sub": "authentik|sub-999",
        "email": "local-admin@example.com",  # matches existing user's email
        "preferred_username": "local-admin",
        "groups": [],  # no admin group
    }

    result = _provision_user(db, userinfo)

    assert result is not None
    assert result.is_admin is True, "local admin should not be touched by OIDC sync"
