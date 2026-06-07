"""Soft-deletion grace period: scheduling, login/session blocking, cancel."""

from datetime import datetime

from tests.conftest import API, auth, make_user


def _schedule_deletion(client, admin, target):
    return client.delete(f"{API}/users/{target.id}", headers=auth(admin))


def test_delete_schedules_instead_of_purging(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", password="pw123456")

    res = _schedule_deletion(client, admin, alice)
    assert res.status_code == 200
    body = res.json()
    assert body["deletion_scheduled_for"] is not None
    assert body["deletion_requested_by"] == admin.id

    # The account still exists (not purged) and is listed for the admin.
    listed = client.get(f"{API}/users", headers=auth(admin)).json()
    assert any(u["id"] == alice.id for u in listed)


def test_scheduled_deadline_uses_grace_period_default_7_days(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice")

    body = _schedule_deletion(client, admin, alice).json()
    scheduled = datetime.fromisoformat(body["deletion_scheduled_for"])
    # Deadline is 7 days out from now by default.
    delta = scheduled - datetime.now(scheduled.tzinfo)
    assert 6 <= delta.days <= 7


def test_pending_user_cannot_log_in(client, db):
    admin = make_user(db, "admin", is_admin=True)
    make_user(db, "alice", password="pw123456")
    alice = client.get(f"{API}/users", headers=auth(admin)).json()
    alice_id = next(u["id"] for u in alice if u["username"] == "alice")

    client.delete(f"{API}/users/{alice_id}", headers=auth(admin))

    res = client.post(
        f"{API}/auth/login", json={"username": "alice", "password": "pw123456"}
    )
    assert res.status_code == 403
    assert res.json()["detail"] == "account_pending_deletion"


def test_pending_user_existing_token_is_rejected(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", password="pw123456")
    headers = auth(alice)

    # Token works before scheduling.
    assert client.get(f"{API}/auth/me", headers=headers).status_code == 200

    _schedule_deletion(client, admin, alice)

    # ...and is rejected immediately afterwards (live session is killed).
    assert client.get(f"{API}/auth/me", headers=headers).status_code == 401


def test_cancel_deletion_restores_access(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice", password="pw123456")

    _schedule_deletion(client, admin, alice)
    assert (
        client.post(
            f"{API}/auth/login", json={"username": "alice", "password": "pw123456"}
        ).status_code
        == 403
    )

    res = client.post(f"{API}/users/{alice.id}/cancel-deletion", headers=auth(admin))
    assert res.status_code == 200
    assert res.json()["deletion_scheduled_for"] is None

    assert (
        client.post(
            f"{API}/auth/login", json={"username": "alice", "password": "pw123456"}
        ).status_code
        == 200
    )


def test_cannot_schedule_self(client, db):
    admin = make_user(db, "admin", is_admin=True)
    make_user(db, "keepadmin", is_admin=True)  # so the last-admin guard isn't hit
    res = client.delete(f"{API}/users/{admin.id}", headers=auth(admin))
    assert res.status_code == 400


def test_non_admin_cannot_schedule_deletion(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    assert client.delete(f"{API}/users/{bob.id}", headers=auth(alice)).status_code == 403


def test_changing_grace_period_does_not_move_existing_deadline(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice")

    first = _schedule_deletion(client, admin, alice).json()["deletion_scheduled_for"]

    # Lower the grace period; the already-scheduled deadline must not move.
    client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"deletion_grace_period_days": 1},
    )
    again = _schedule_deletion(client, admin, alice).json()["deletion_scheduled_for"]
    assert again == first
