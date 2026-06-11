"""Tests for user tab preferences endpoints."""

from tests.conftest import API, auth, make_user


def test_get_tab_preferences_defaults(client, db):
    alice = make_user(db, "alice")
    res = client.get(f"{API}/users/me/preferences/tabs", headers=auth(alice))
    assert res.status_code == 200
    body = res.json()
    assert body == {"order": [], "hidden": []}


def test_put_tab_preferences_persists(client, db):
    alice = make_user(db, "alice")
    payload = {"order": ["tree-view", "list-view"], "hidden": ["gallery-view"]}
    res = client.put(
        f"{API}/users/me/preferences/tabs", headers=auth(alice), json=payload
    )
    assert res.status_code == 200
    assert res.json() == payload

    res2 = client.get(f"{API}/users/me/preferences/tabs", headers=auth(alice))
    assert res2.status_code == 200
    assert res2.json() == payload


def test_delete_tab_preferences_resets(client, db):
    alice = make_user(db, "alice")
    client.put(
        f"{API}/users/me/preferences/tabs",
        headers=auth(alice),
        json={"order": ["list-view"], "hidden": []},
    )
    res = client.delete(f"{API}/users/me/preferences/tabs", headers=auth(alice))
    assert res.status_code == 200
    assert res.json() == {"order": [], "hidden": []}

    res2 = client.get(f"{API}/users/me/preferences/tabs", headers=auth(alice))
    assert res2.json() == {"order": [], "hidden": []}


def test_tab_preferences_deduplicates(client, db):
    alice = make_user(db, "alice")
    payload = {"order": ["tree-view", "tree-view", "list-view"], "hidden": []}
    res = client.put(
        f"{API}/users/me/preferences/tabs", headers=auth(alice), json=payload
    )
    assert res.status_code == 200
    assert res.json()["order"] == ["tree-view", "list-view"]


def test_tab_preferences_requires_auth(client, db):
    res = client.get(f"{API}/users/me/preferences/tabs")
    assert res.status_code == 401


def test_tab_preferences_two_users_isolated(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    client.put(
        f"{API}/users/me/preferences/tabs",
        headers=auth(alice),
        json={"order": ["list-view"], "hidden": []},
    )
    res = client.get(f"{API}/users/me/preferences/tabs", headers=auth(bob))
    assert res.json() == {"order": [], "hidden": []}
