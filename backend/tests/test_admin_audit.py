"""Coverage for the instance-wide administrator audit trail."""

import json

import pyotp
from sqlalchemy import select

from app.models.admin_audit import AdminAuditLog
from app.services.system.backups import backup_service
from tests.conftest import API, auth, make_tree, make_user


def _entries(db):
    return list(db.scalars(select(AdminAuditLog)).all())


def _add(
    db,
    *,
    subject_type="tree",
    subject_label=None,
    action="update",
    actor_username="alice",
    created_at=None,
    details=None,
):
    """Insert an audit row directly, controlling created_at for ordering."""
    row = AdminAuditLog(
        actor_username=actor_username,
        action=action,
        subject_type=subject_type,
        subject_label=subject_label,
        details=details,
    )
    if created_at is not None:
        row.created_at = created_at
    db.add(row)
    db.commit()
    return row


def test_tree_deletion_survives_its_tree(client, db):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner, name="Family archive")

    response = client.delete(f"{API}/workspaces/{tree.id}", headers=auth(owner))

    assert response.status_code == 204
    entry = _entries(db)[0]
    assert entry.action == "delete"
    assert entry.subject_type == "tree"
    assert entry.subject_id == tree.id
    assert entry.subject_label == "Family archive"


def test_admin_audit_endpoint_is_read_only_and_admin_only(client, db):
    admin = make_user(db, "admin", is_admin=True)
    user = make_user(db, "user")
    tree = make_tree(db, user)
    client.delete(f"{API}/workspaces/{tree.id}", headers=auth(user))

    denied = client.get(f"{API}/admin/audit-log", headers=auth(user))
    allowed = client.get(f"{API}/admin/audit-log", headers=auth(admin))

    assert denied.status_code == 403
    assert allowed.status_code == 200
    body = allowed.json()
    assert body["total"] == 1
    assert body["items"][0]["subject_type"] == "tree"


def test_successful_login_is_recorded_without_credentials(client, db):
    user = make_user(db, "alice", password="correct-password")

    response = client.post(
        f"{API}/auth/login",
        json={"username": user.username, "password": "correct-password"},
    )

    assert response.status_code == 200
    entry = _entries(db)[0]
    assert entry.subject_type == "auth_login"
    assert entry.actor_id == user.id
    assert entry.details is None


# --- Pagination + total ----------------------------------------------------


def test_pagination_reports_total_and_keeps_old_entries_discoverable(client, db):
    admin = make_user(db, "admin", is_admin=True)
    # Five entries with strictly increasing timestamps; newest sorts first.
    for i in range(1, 6):
        _add(db, subject_label=f"entry-{i}", created_at=f"2026-01-0{i}T00:00:00+00:00")

    first = client.get(
        f"{API}/admin/audit-log?limit=2&offset=0", headers=auth(admin)
    ).json()
    assert first["total"] == 5
    assert first["limit"] == 2
    assert [e["subject_label"] for e in first["items"]] == ["entry-5", "entry-4"]

    # The oldest entry is absent from the newest page but reachable by paging.
    assert "entry-1" not in [e["subject_label"] for e in first["items"]]
    last = client.get(
        f"{API}/admin/audit-log?limit=2&offset=4", headers=auth(admin)
    ).json()
    assert last["total"] == 5
    assert [e["subject_label"] for e in last["items"]] == ["entry-1"]


# --- Filters ---------------------------------------------------------------


def test_filters_by_action_subject_and_actor(client, db):
    admin = make_user(db, "admin", is_admin=True)
    _add(db, action="create", subject_type="user", actor_username="root")
    _add(db, action="update", subject_type="user", actor_username="root")
    _add(db, action="delete", subject_type="backup", actor_username="scheduler")

    by_action = client.get(
        f"{API}/admin/audit-log?action=create", headers=auth(admin)
    ).json()
    assert by_action["total"] == 1
    assert by_action["items"][0]["action"] == "create"

    by_subject = client.get(
        f"{API}/admin/audit-log?subject_type=user", headers=auth(admin)
    ).json()
    assert by_subject["total"] == 2

    by_actor = client.get(
        f"{API}/admin/audit-log?actor=sched", headers=auth(admin)
    ).json()
    assert by_actor["total"] == 1
    assert by_actor["items"][0]["actor_username"] == "scheduler"


def test_filters_by_time_range_inclusive_of_end_day(client, db):
    admin = make_user(db, "admin", is_admin=True)
    _add(db, subject_label="jan", created_at="2026-01-15T09:00:00+00:00")
    _add(db, subject_label="feb", created_at="2026-02-15T09:00:00+00:00")
    _add(db, subject_label="mar", created_at="2026-03-15T09:00:00+00:00")

    ranged = client.get(
        f"{API}/admin/audit-log?start=2026-02-01&end=2026-02-28",
        headers=auth(admin),
    ).json()
    assert [e["subject_label"] for e in ranged["items"]] == ["feb"]

    # A date-only end bound still includes entries later that same day.
    same_day = client.get(
        f"{API}/admin/audit-log?start=2026-02-15&end=2026-02-15",
        headers=auth(admin),
    ).json()
    assert [e["subject_label"] for e in same_day["items"]] == ["feb"]


# --- Facets + export -------------------------------------------------------


def test_subject_types_facet_lists_distinct_values(client, db):
    admin = make_user(db, "admin", is_admin=True)
    _add(db, subject_type="user")
    _add(db, subject_type="user")
    _add(db, subject_type="backup")

    response = client.get(f"{API}/admin/audit-log/subject-types", headers=auth(admin))

    assert response.status_code == 200
    assert response.json() == ["backup", "user"]


def test_export_returns_csv_with_all_matching_rows(client, db):
    admin = make_user(db, "admin", is_admin=True)
    _add(
        db,
        subject_type="user",
        subject_label="bob",
        actor_username="root",
        details={"is_admin": True},
    )
    _add(db, subject_type="backup", subject_label="nightly", actor_username="root")

    response = client.get(
        f"{API}/admin/audit-log/export?subject_type=user", headers=auth(admin)
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    lines = [line for line in response.text.splitlines() if line]
    assert lines[0].startswith("created_at,actor_username")
    # Only the filtered ("user") row is exported, with its details JSON intact.
    assert len(lines) == 2
    assert "bob" in lines[1]
    assert '{""is_admin"": true}' in lines[1]
    assert "nightly" not in response.text


# --- Consistent auditing of security-relevant events -----------------------


def test_two_factor_enable_and_disable_are_audited_without_secrets(client, db):
    user = make_user(db, "alice", password="secret")

    setup = client.post(f"{API}/auth/2fa/setup", headers=auth(user))
    secret = setup.json()["secret"]
    code = pyotp.TOTP(secret).now()

    enabled = client.post(
        f"{API}/auth/2fa/enable", json={"code": code}, headers=auth(user)
    )
    assert enabled.status_code == 200

    disabled = client.post(
        f"{API}/auth/2fa/disable",
        json={"password": "secret", "code": pyotp.TOTP(secret).now()},
        headers=auth(user),
    )
    assert disabled.status_code == 204

    events = db.scalars(
        select(AdminAuditLog)
        .where(AdminAuditLog.subject_type == "two_factor")
        .order_by(AdminAuditLog.created_at)
    ).all()
    assert [e.details for e in events] == [{"enabled": True}, {"enabled": False}]
    assert all(e.actor_id == user.id for e in events)
    # The shared secret must never leak into the trail.
    assert secret not in json.dumps([e.details for e in events])


def test_backup_failure_is_audited(db, monkeypatch):
    admin = make_user(db, "admin", is_admin=True)
    monkeypatch.setattr(backup_service, "_ensure_backup_dir", lambda: None)

    def _boom(_db):
        raise RuntimeError("disk exploded")

    monkeypatch.setattr(backup_service, "_collect_bundle", _boom)

    record = backup_service.create_backup(db, trigger="manual", actor=admin)

    assert record.status == "failed"
    entry = db.scalars(
        select(AdminAuditLog).where(AdminAuditLog.subject_type == "backup")
    ).one()
    assert entry.details["status"] == "failed"
    assert entry.details["trigger"] == "manual"
    assert "disk exploded" in entry.details["error"]


def test_public_access_and_password_changes_are_audited(client, db):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner, name="Public roots")

    made_public = client.patch(
        f"{API}/workspaces/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(owner),
    )
    assert made_public.status_code == 200

    set_password = client.put(
        f"{API}/workspaces/{tree.id}/public/password",
        json={"password": "hunter2pass"},
        headers=auth(owner),
    )
    assert set_password.status_code == 200

    events = db.scalars(
        select(AdminAuditLog).where(AdminAuditLog.subject_type == "tree_public_access")
    ).all()
    assert len(events) == 2
    details = [e.details for e in events]
    assert any(d.get("after", {}).get("public_role") == "viewer" for d in details)
    assert {"password_protected": True} in details
    # The public password must never be recorded.
    assert "hunter2pass" not in json.dumps(details)
