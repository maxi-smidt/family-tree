"""Self-serve account deletion and restore."""

from app.models import User as UserModel
from tests.conftest import API, auth, make_user


def _delete(client, user, *, password=None, confirm_username=None):
    return client.post(
        f"{API}/auth/delete-account",
        headers=auth(user),
        json={"password": password, "confirm_username": confirm_username},
    )


def _restore(client, username, password):
    return client.post(
        f"{API}/auth/restore-account",
        json={"username": username, "password": password},
    )


def _make_oidc_user(db, username="oidcuser"):
    user = UserModel(
        username=username,
        email=f"{username}@example.com",
        full_name=username.title(),
        hashed_password=None,
        is_admin=False,
        is_active=True,
        auth_provider="oidc",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_self_delete_schedules_with_self_as_requestor(client, db):
    alice = make_user(db, "alice", password="pw123456")
    res = _delete(client, alice, password="pw123456")
    assert res.status_code == 200
    body = res.json()
    assert body["deletion_scheduled_for"] is not None
    assert body["deletion_requested_by"] == alice.id


def test_self_delete_wrong_password(client, db):
    alice = make_user(db, "alice", password="pw123456")
    assert _delete(client, alice, password="wrongpassword").status_code == 400


def test_self_delete_missing_password_for_local(client, db):
    alice = make_user(db, "alice", password="pw123456")
    assert _delete(client, alice).status_code == 400


def test_self_delete_oidc_matching_username(client, db):
    alice = _make_oidc_user(db, "alice")
    assert _delete(client, alice, confirm_username="alice").status_code == 200


def test_self_delete_oidc_wrong_username(client, db):
    alice = _make_oidc_user(db, "alice")
    assert _delete(client, alice, confirm_username="notme").status_code == 400


def test_self_delete_oidc_missing_confirmation(client, db):
    alice = _make_oidc_user(db, "alice")
    assert _delete(client, alice).status_code == 400


def test_last_admin_cannot_self_delete(client, db):
    admin = make_user(db, "admin", is_admin=True)
    assert _delete(client, admin, password="secret").status_code == 400


def test_non_last_admin_can_self_delete(client, db):
    admin1 = make_user(db, "admin1", is_admin=True)
    make_user(db, "admin2", is_admin=True)
    assert _delete(client, admin1, password="secret").status_code == 200


def test_self_restore_clears_deletion_and_returns_token(client, db):
    alice = make_user(db, "alice", password="pw123456")
    _delete(client, alice, password="pw123456")
    # Login is blocked during grace period
    assert (
        client.post(
            f"{API}/auth/login", json={"username": "alice", "password": "pw123456"}
        ).status_code
        == 403
    )
    res = _restore(client, "alice", "pw123456")
    assert res.status_code == 200
    assert "access_token" in res.json()
    # Normal login works again after restore
    assert (
        client.post(
            f"{API}/auth/login", json={"username": "alice", "password": "pw123456"}
        ).status_code
        == 200
    )


def test_restore_rejected_for_admin_initiated_deletion(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", password="pw123456")
    client.delete(f"{API}/users/{alice.id}", headers=auth(admin))
    assert _restore(client, "alice", "pw123456").status_code == 403


def test_restore_wrong_password(client, db):
    alice = make_user(db, "alice", password="pw123456")
    _delete(client, alice, password="pw123456")
    assert _restore(client, "alice", "wrongpassword").status_code == 401


def test_restore_account_not_pending(client, db):
    make_user(db, "alice", password="pw123456")
    assert _restore(client, "alice", "pw123456").status_code == 400
