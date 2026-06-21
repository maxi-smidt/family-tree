"""Integration tests for the SSE endpoint.

The streaming response is an infinite async generator that cannot be
consumed end-to-end in the synchronous TestClient without the connection
being torn down server-side.  These tests cover the authentication-gate
logic (the most critical path); the streaming protocol itself is covered
by the event-bus unit tests and the E2E playwright suite.
"""

from app.core.security import create_access_token
from tests.conftest import API, make_user


def test_sse_no_token_returns_401(client):
    res = client.get(f"{API}/sse/events")
    assert res.status_code == 401


def test_sse_invalid_token_returns_401(client):
    res = client.get(f"{API}/sse/events?token=not-a-real-token")
    assert res.status_code == 401


def test_sse_inactive_user_returns_401(client, db):
    user = make_user(db, "inactive", is_active=False)
    token = create_access_token(user.id)
    res = client.get(f"{API}/sse/events?token={token}")
    assert res.status_code == 401
