"""Tests for admin feature flags (issue #211): resolution, admin API, gating."""

from app.services import feature_service
from tests.conftest import API, auth, make_tree, make_user

# ---------------------------------------------------------------------------
# Resolution logic: on / off / beta x in / out of allowlist
# ---------------------------------------------------------------------------


def test_default_state_is_enabled_for_everyone(db):
    user = make_user(db, "alice")
    assert feature_service.is_enabled(db, "gallery", user)
    assert set(feature_service.enabled_for(db, user)) == set(feature_service.FEATURES)


def test_off_disables_for_everyone_including_admins(db):
    user = make_user(db, "alice")
    admin = make_user(db, "root", is_admin=True)
    feature_service.set_state(db, "gallery", "off")
    db.commit()

    assert not feature_service.is_enabled(db, "gallery", user)
    assert not feature_service.is_enabled(db, "gallery", admin)
    assert "gallery" not in feature_service.enabled_for(db, user)


def test_beta_enables_only_allowlisted_users(db):
    tester = make_user(db, "tester")
    other = make_user(db, "other")
    feature_service.set_state(db, "statistics", "beta")
    feature_service.set_allowlist(db, "statistics", [tester.id])
    db.commit()

    assert feature_service.is_enabled(db, "statistics", tester)
    assert not feature_service.is_enabled(db, "statistics", other)
    assert "statistics" in feature_service.enabled_for(db, tester)
    assert "statistics" not in feature_service.enabled_for(db, other)


def test_on_and_off_ignore_the_allowlist(db):
    tester = make_user(db, "tester")
    feature_service.set_allowlist(db, "events", [tester.id])
    feature_service.set_state(db, "events", "off")
    db.commit()
    assert not feature_service.is_enabled(db, "events", tester)

    feature_service.set_state(db, "events", "on")
    db.commit()
    other = make_user(db, "other")
    assert feature_service.is_enabled(db, "events", other)


def test_invalid_stored_state_falls_back_to_default(db):
    user = make_user(db, "alice")
    from app.services.settings_service import set_setting

    set_setting(db, "feature.gallery", "garbage")
    db.commit()
    assert feature_service.get_state(db, "gallery") == "on"
    assert feature_service.is_enabled(db, "gallery", user)


# ---------------------------------------------------------------------------
# Admin API
# ---------------------------------------------------------------------------


def test_list_features_returns_full_registry(client, db):
    admin = make_user(db, "root", is_admin=True)
    res = client.get(f"{API}/admin/features", headers=auth(admin))
    assert res.status_code == 200
    flags = {f["name"]: f for f in res.json()}
    assert set(flags) == set(feature_service.FEATURES)
    assert all(f["state"] == "on" for f in flags.values())
    assert all(f["allowlist"] == [] for f in flags.values())


def test_features_api_requires_admin(client, db):
    user = make_user(db, "alice")
    assert client.get(f"{API}/admin/features", headers=auth(user)).status_code == 403
    res = client.patch(
        f"{API}/admin/features/gallery", headers=auth(user), json={"state": "off"}
    )
    assert res.status_code == 403


def test_patch_state_and_allowlist(client, db):
    admin = make_user(db, "root", is_admin=True)
    tester = make_user(db, "tester")

    res = client.patch(
        f"{API}/admin/features/gallery",
        headers=auth(admin),
        json={"state": "beta", "allowlist": [tester.id]},
    )
    assert res.status_code == 200
    assert res.json() == {
        "name": "gallery",
        "state": "beta",
        "allowlist": [tester.id],
    }

    # Allowlist can be replaced independently of the state.
    res = client.patch(
        f"{API}/admin/features/gallery", headers=auth(admin), json={"allowlist": []}
    )
    assert res.status_code == 200
    assert res.json()["allowlist"] == []
    assert res.json()["state"] == "beta"


def test_patch_unknown_feature_or_state_rejected(client, db):
    admin = make_user(db, "root", is_admin=True)
    res = client.patch(
        f"{API}/admin/features/nope", headers=auth(admin), json={"state": "off"}
    )
    assert res.status_code == 404

    res = client.patch(
        f"{API}/admin/features/gallery", headers=auth(admin), json={"state": "maybe"}
    )
    assert res.status_code == 422


def test_patch_unknown_allowlist_user_rejected(client, db):
    admin = make_user(db, "root", is_admin=True)
    res = client.patch(
        f"{API}/admin/features/gallery",
        headers=auth(admin),
        json={"allowlist": ["ghost"]},
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Route gating
# ---------------------------------------------------------------------------


def _set_flag(client, admin, name, state, allowlist=None):
    payload = {"state": state}
    if allowlist is not None:
        payload["allowlist"] = allowlist
    res = client.patch(
        f"{API}/admin/features/{name}", headers=auth(admin), json=payload
    )
    assert res.status_code == 200


def test_disabled_feature_routes_return_404(client, db):
    admin = make_user(db, "root", is_admin=True)
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)

    assert (
        client.get(
            f"{API}/trees/{tree.id}/gallery/images", headers=auth(owner)
        ).status_code
        == 200
    )

    _set_flag(client, admin, "gallery", "off")
    res = client.get(f"{API}/trees/{tree.id}/gallery/images", headers=auth(owner))
    assert res.status_code == 404
    # Writes are gated too, not just reads.
    res = client.post(
        f"{API}/trees/{tree.id}/gallery/images",
        headers=auth(owner),
        json={"title": "x"},
    )
    assert res.status_code == 404


def test_beta_route_enabled_only_for_allowlisted_user(client, db):
    admin = make_user(db, "root", is_admin=True)
    owner = make_user(db, "alice")
    tester = make_user(db, "tester")
    tree = make_tree(db, owner)

    _set_flag(client, admin, "quality_report", "beta", allowlist=[tester.id])

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(owner))
    assert res.status_code == 404

    # The tester still needs read access to the tree itself.
    from tests.conftest import share

    share(db, tree, tester, role="viewer")
    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(tester))
    assert res.status_code == 200


def test_disabled_gedcom_endpoints_return_404(client, db):
    admin = make_user(db, "root", is_admin=True)
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)

    _set_flag(client, admin, "gedcom", "off")
    res = client.get(f"{API}/trees/{tree.id}/export-gedcom", headers=auth(owner))
    assert res.status_code == 404
    # The encrypted export in the same router stays available (core feature).
    res = client.post(f"{API}/trees/{tree.id}/export", headers=auth(owner), json={})
    assert res.status_code == 200


def test_disabled_virtual_views_return_404(client, db):
    admin = make_user(db, "root", is_admin=True)
    owner = make_user(db, "alice")

    assert (
        client.get(f"{API}/virtual-views", headers=auth(owner)).status_code == 200
    )
    _set_flag(client, admin, "virtual_views", "off")
    assert (
        client.get(f"{API}/virtual-views", headers=auth(owner)).status_code == 404
    )


# ---------------------------------------------------------------------------
# Resolved feature set in auth responses
# ---------------------------------------------------------------------------


def test_me_returns_resolved_feature_set(client, db):
    admin = make_user(db, "root", is_admin=True)
    user = make_user(db, "alice")

    res = client.get(f"{API}/auth/me", headers=auth(user))
    assert res.status_code == 200
    assert set(res.json()["features"]) == set(feature_service.FEATURES)

    _set_flag(client, admin, "gallery", "off")
    _set_flag(client, admin, "statistics", "beta", allowlist=[user.id])

    features = client.get(f"{API}/auth/me", headers=auth(user)).json()["features"]
    assert "gallery" not in features
    assert "statistics" in features


def test_login_returns_resolved_feature_set(client, db):
    make_user(db, "alice", password="secret123")
    res = client.post(
        f"{API}/auth/login", json={"username": "alice", "password": "secret123"}
    )
    assert res.status_code == 200
    assert set(res.json()["user"]["features"]) == set(feature_service.FEATURES)
