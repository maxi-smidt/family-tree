"""Integration tests for the SSE endpoint.

The streaming response is an infinite async generator that cannot be
consumed end-to-end in the synchronous TestClient without the connection
being torn down server-side.  These tests cover the authentication-gate
logic (the most critical path); the streaming protocol itself is covered
by the event-bus unit tests and the E2E playwright suite.
"""

from app.core.security import create_access_token, create_sse_ticket_token
from tests.conftest import API, auth, make_user


def test_sse_no_token_returns_401(client):
    res = client.get(f"{API}/sse/events")
    assert res.status_code == 401


def test_sse_invalid_token_returns_401(client):
    res = client.get(f"{API}/sse/events?ticket=not-a-real-token")
    assert res.status_code == 401


def test_sse_inactive_user_returns_401(client, db):
    user = make_user(db, "inactive", is_active=False)
    ticket = create_sse_ticket_token(user.id)
    res = client.get(f"{API}/sse/events?ticket={ticket}")
    assert res.status_code == 401


def test_sse_ticket_requires_normal_authentication(client, db):
    user = make_user(db, "ticket-user")

    response = client.post(f"{API}/sse/ticket", headers=auth(user))

    assert response.status_code == 200
    assert response.json()["ticket"]


def test_access_token_is_not_accepted_as_sse_ticket(client, db):
    user = make_user(db, "access-token-user")
    access_token = create_access_token(user.id)

    response = client.get(f"{API}/sse/events?ticket={access_token}")

    assert response.status_code == 401
