"""Tests for the release announcement popup feature.

- GET /users/me/preferences/announcement/current returns stored content
  and falls back version → APP_VERSION when blank.
- PUT /users/me/preferences/announcement persists ack into user.preferences.
- Empty content returns empty strings.
- Admin-only PATCH /settings works for announcement fields; non-admin gets 403.
"""

from app.core.config import settings
from tests.conftest import API, auth, make_user


def test_current_announcement_defaults_to_empty(client, db):
    alice = make_user(db, "alice")
    res = client.get(
        f"{API}/users/me/preferences/announcement/current", headers=auth(alice)
    )
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == ""
    assert body["body"] == ""
    # version falls back to APP_VERSION when announcement_version is blank
    assert body["version"] == settings.APP_VERSION
    assert body["acknowledged_version"] is None


def test_current_announcement_returns_stored_content(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice")

    # Set announcement content via the admin settings endpoint
    resp = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={
            "announcement_title": "Big Release",
            "announcement_body": "## New feature\nEnjoy it.",
            "announcement_version": "1.2.3",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["announcement_title"] == "Big Release"
    assert data["announcement_body"] == "## New feature\nEnjoy it."
    assert data["announcement_version"] == "1.2.3"

    # A regular user can read the announcement
    res = client.get(
        f"{API}/users/me/preferences/announcement/current", headers=auth(alice)
    )
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "Big Release"
    assert body["body"] == "## New feature\nEnjoy it."
    assert body["version"] == "1.2.3"
    assert body["acknowledged_version"] is None


def test_current_announcement_version_falls_back_to_app_version(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice")

    # Set content but leave version blank
    client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={
            "announcement_title": "Hello",
            "announcement_body": "World",
            "announcement_version": "",
        },
    )

    res = client.get(
        f"{API}/users/me/preferences/announcement/current", headers=auth(alice)
    )
    assert res.status_code == 200
    body = res.json()
    assert body["version"] == settings.APP_VERSION


def test_put_announcement_ack_persists(client, db):
    alice = make_user(db, "alice")

    res = client.put(
        f"{API}/users/me/preferences/announcement",
        headers=auth(alice),
        json={"acknowledged_version": "1.2.3"},
    )
    assert res.status_code == 200
    assert res.json()["acknowledged_version"] == "1.2.3"

    # Verify it is returned on subsequent GET
    res2 = client.get(
        f"{API}/users/me/preferences/announcement", headers=auth(alice)
    )
    assert res2.status_code == 200
    assert res2.json()["acknowledged_version"] == "1.2.3"


def test_put_announcement_ack_appears_in_current(client, db):
    admin = make_user(db, "admin", is_admin=True)
    alice = make_user(db, "alice")

    client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={
            "announcement_title": "News",
            "announcement_body": "Details here.",
            "announcement_version": "2.0.0",
        },
    )

    # Alice acks the announcement
    client.put(
        f"{API}/users/me/preferences/announcement",
        headers=auth(alice),
        json={"acknowledged_version": "2.0.0"},
    )

    res = client.get(
        f"{API}/users/me/preferences/announcement/current", headers=auth(alice)
    )
    assert res.status_code == 200
    body = res.json()
    assert body["acknowledged_version"] == "2.0.0"


def test_announcement_ack_is_per_user(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")

    client.put(
        f"{API}/users/me/preferences/announcement",
        headers=auth(alice),
        json={"acknowledged_version": "1.0.0"},
    )

    res = client.get(
        f"{API}/users/me/preferences/announcement", headers=auth(bob)
    )
    assert res.status_code == 200
    assert res.json()["acknowledged_version"] is None


def test_admin_settings_announcement_fields(client, db):
    admin = make_user(db, "admin", is_admin=True)

    resp = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={
            "announcement_title": "Title here",
            "announcement_body": "Body here",
            "announcement_version": "3.0.0",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["announcement_title"] == "Title here"
    assert data["announcement_body"] == "Body here"
    assert data["announcement_version"] == "3.0.0"

    # GET settings also returns announcement fields
    resp2 = client.get(f"{API}/settings", headers=auth(admin))
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["announcement_title"] == "Title here"
    assert data2["announcement_body"] == "Body here"
    assert data2["announcement_version"] == "3.0.0"


def test_non_admin_cannot_patch_settings(client, db):
    alice = make_user(db, "alice")
    resp = client.patch(
        f"{API}/settings",
        headers=auth(alice),
        json={"announcement_title": "Hack"},
    )
    assert resp.status_code == 403


def test_announcement_requires_auth(client, db):
    res = client.get(f"{API}/users/me/preferences/announcement/current")
    assert res.status_code == 401

    res2 = client.get(f"{API}/users/me/preferences/announcement")
    assert res2.status_code == 401
