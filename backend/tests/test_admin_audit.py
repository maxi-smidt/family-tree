"""Coverage for the instance-wide administrator audit trail."""

from sqlalchemy import select

from app.models.admin_audit import AdminAuditLog
from tests.conftest import API, auth, make_tree, make_user


def _entries(db):
    return list(db.scalars(select(AdminAuditLog)).all())


def test_tree_deletion_survives_its_tree(client, db):
    owner = make_user(db, "owner")
    tree = make_tree(db, owner, name="Family archive")

    response = client.delete(f"{API}/trees/{tree.id}", headers=auth(owner))

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
    client.delete(f"{API}/trees/{tree.id}", headers=auth(user))

    denied = client.get(f"{API}/admin/audit-log", headers=auth(user))
    allowed = client.get(f"{API}/admin/audit-log", headers=auth(admin))

    assert denied.status_code == 403
    assert allowed.status_code == 200
    assert allowed.json()[0]["subject_type"] == "tree"


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
