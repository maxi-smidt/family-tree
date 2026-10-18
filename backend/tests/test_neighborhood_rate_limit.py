"""Request-volume throttle for GET .../members/neighborhood (#1032)."""

from app.core.rate_limit import neighborhood_rate_limiter
from tests.conftest import API, auth, make_tree, make_user, share


def _neighborhood(client, tree, user, extra_headers=None):
    headers = dict(auth(user)) if user else {}
    headers.update(extra_headers or {})
    return client.get(
        f"{API}/workspaces/{tree.id}/members/neighborhood",
        headers=headers,
    )


def test_authenticated_caller_is_rate_limited_after_the_budget(db, client, monkeypatch):
    monkeypatch.setattr(neighborhood_rate_limiter, "max_attempts", 3)
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    for _ in range(3):
        assert _neighborhood(client, tree, user).status_code == 200

    throttled = _neighborhood(client, tree, user)
    assert throttled.status_code == 429
    assert "Retry-After" in throttled.headers


def test_budget_is_per_principal_not_shared_across_users(db, client, monkeypatch):
    monkeypatch.setattr(neighborhood_rate_limiter, "max_attempts", 1)
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    other = make_user(db, "bob")
    share(db, tree, other, role="viewer")

    assert _neighborhood(client, tree, owner).status_code == 200
    assert _neighborhood(client, tree, owner).status_code == 429
    # A different principal on the same workspace has its own budget.
    assert _neighborhood(client, tree, other).status_code == 200


def test_anonymous_public_callers_are_rate_limited_by_ip(db, client, monkeypatch):
    monkeypatch.setattr(neighborhood_rate_limiter, "max_attempts", 2)
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    client.patch(
        f"{API}/workspaces/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(user),
    )

    for _ in range(2):
        assert _neighborhood(client, tree, None).status_code == 200

    throttled = _neighborhood(client, tree, None)
    assert throttled.status_code == 429
    assert "Retry-After" in throttled.headers


def test_anonymous_budget_is_per_forwarded_client_not_the_proxy(db, client, monkeypatch):
    """Behind the bundled nginx (AGENTS.md), every anonymous request shares
    the same socket peer — the limiter must key off X-Forwarded-For instead,
    or one public viewer could exhaust the bucket for every other viewer."""
    monkeypatch.setattr(neighborhood_rate_limiter, "max_attempts", 1)
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    client.patch(
        f"{API}/workspaces/{tree.id}/public",
        json={"public_role": "viewer"},
        headers=auth(user),
    )

    headers_a = {"X-Forwarded-For": "203.0.113.1"}
    assert _neighborhood(client, tree, None, headers_a).status_code == 200
    assert _neighborhood(client, tree, None, headers_a).status_code == 429
    # A different forwarded client is not affected by the first one's budget.
    headers_b = {"X-Forwarded-For": "203.0.113.2"}
    assert _neighborhood(client, tree, None, headers_b).status_code == 200
