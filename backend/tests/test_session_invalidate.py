"""Tests that account-state changes emit session.invalidate SSE events."""

from unittest.mock import patch

import pytest

from tests.conftest import API, auth, make_user


@pytest.fixture()
def admin(db):
    return make_user(db, "admin", is_admin=True)


@pytest.fixture()
def target(db):
    return make_user(db, "target")


@pytest.fixture()
def admin_headers(admin):
    return auth(admin)


def test_deactivate_user_emits_session_invalidate(client, db, admin, target, admin_headers):
    with patch("app.api.routes.users.event_bus") as m:
        res = client.patch(
            f"{API}/users/{target.id}",
            json={"is_active": False},
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
    m.publish.assert_called_once_with(
        [target.id], "session.invalidate", {"reason": "deactivated"}
    )


def test_activate_user_does_not_emit_session_invalidate(client, db, admin, target, admin_headers):
    with patch("app.api.routes.users.event_bus") as m:
        res = client.patch(
            f"{API}/users/{target.id}",
            json={"is_active": True},
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
    m.publish.assert_not_called()


def test_schedule_deletion_emits_session_invalidate(client, db, admin, target, admin_headers):
    with patch("app.api.routes.users.event_bus") as m:
        res = client.delete(
            f"{API}/users/{target.id}",
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
    m.publish.assert_called_once_with(
        [target.id], "session.invalidate", {"reason": "pending_deletion"}
    )
