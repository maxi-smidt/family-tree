"""Tests for the per-user What's New version acknowledgement."""

from app.core.config import settings
from tests.conftest import API, auth, make_user


def test_whats_new_state_is_empty_until_read(client, db):
    alice = make_user(db, "alice")

    res = client.get(f"{API}/users/me/preferences/whats-new", headers=auth(alice))

    assert res.status_code == 200
    assert res.json() == {"last_read_version": None}


def test_marking_whats_new_as_read_stores_the_running_version(client, db):
    alice = make_user(db, "alice")

    res = client.put(f"{API}/users/me/preferences/whats-new", headers=auth(alice))

    assert res.status_code == 200
    assert res.json() == {"last_read_version": settings.APP_VERSION}

    state = client.get(f"{API}/users/me/preferences/whats-new", headers=auth(alice))
    assert state.status_code == 200
    assert state.json() == {"last_read_version": settings.APP_VERSION}


def test_whats_new_state_is_per_user(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")

    client.put(f"{API}/users/me/preferences/whats-new", headers=auth(alice))

    state = client.get(f"{API}/users/me/preferences/whats-new", headers=auth(bob))
    assert state.status_code == 200
    assert state.json() == {"last_read_version": None}


def test_whats_new_requires_authentication(client):
    assert client.get(f"{API}/users/me/preferences/whats-new").status_code == 401
    assert client.put(f"{API}/users/me/preferences/whats-new").status_code == 401
