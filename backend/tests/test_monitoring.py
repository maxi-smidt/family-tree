"""Tests for the optional Sentry error-monitoring integration."""

from unittest.mock import MagicMock, patch

from app.core.monitoring import _scrub, init_sentry


def test_init_sentry_noop_when_dsn_unset():
    """init_sentry() must be a complete no-op when SENTRY_DSN is not set."""
    with patch("app.core.config.settings") as mock_settings:
        mock_settings.sentry_enabled = False
        with patch("sentry_sdk.init") as mock_init:
            init_sentry()
            mock_init.assert_not_called()


def test_init_sentry_initialises_when_dsn_set():
    """init_sentry() calls sentry_sdk.init with the right arguments."""
    with patch("app.core.config.settings") as mock_settings:
        mock_settings.sentry_enabled = True
        mock_settings.SENTRY_DSN = "https://key@sentry.example.com/1"
        mock_settings.ENVIRONMENT = "production"
        mock_settings.APP_VERSION = "1.0.0"
        mock_settings.SENTRY_TRACES_SAMPLE_RATE = 0.1
        with patch("sentry_sdk.init") as mock_init:
            init_sentry()
            mock_init.assert_called_once()
            call_kwargs = mock_init.call_args.kwargs
            assert call_kwargs["dsn"] == "https://key@sentry.example.com/1"
            assert call_kwargs["send_default_pii"] is False
            assert call_kwargs["before_send"] is _scrub


def test_scrub_removes_auth_header():
    """_scrub must redact Authorization and Cookie headers."""
    event = {
        "request": {
            "headers": {
                "Authorization": "Bearer eyABC.DEF.GHI",
                "Cookie": "session=abc",
                "Content-Type": "application/json",
            }
        }
    }
    result = _scrub(event, MagicMock())
    headers = result["request"]["headers"]
    assert headers["Authorization"] == "[filtered]"
    assert headers["Cookie"] == "[filtered]"
    assert headers["Content-Type"] == "application/json"


def test_scrub_removes_cookies_dict():
    """_scrub must drop the top-level cookies dict."""
    event = {"request": {"cookies": {"session": "secret"}}}
    result = _scrub(event, MagicMock())
    assert "cookies" not in result.get("request", {})


def test_scrub_removes_email_from_user_context():
    """_scrub must remove the email field from the Sentry user context."""
    event = {"user": {"id": "42", "email": "alice@example.com"}}
    result = _scrub(event, MagicMock())
    assert "email" not in result.get("user", {})
    assert result["user"]["id"] == "42"


def test_scrub_redacts_email_in_header_value():
    """_scrub must replace e-mail addresses in header values."""
    event = {
        "request": {
            "headers": {"X-Custom": "user is alice@example.com here"}
        }
    }
    result = _scrub(event, MagicMock())
    assert "alice@example.com" not in result["request"]["headers"]["X-Custom"]
    assert "[email]" in result["request"]["headers"]["X-Custom"]


def test_scrub_removes_query_string():
    """_scrub must strip query_string and remove it from the URL."""
    event = {
        "request": {
            "url": "https://example.com/api/members?search=alice",
            "query_string": "search=alice",
        }
    }
    result = _scrub(event, MagicMock())
    assert "query_string" not in result["request"]
    assert "?" not in result["request"]["url"]


def test_scrub_drops_media_breadcrumbs():
    """_scrub must filter out breadcrumbs referencing media URLs."""
    event = {
        "breadcrumbs": {
            "values": [
                {"message": "Fetched /media/abc.jpg"},
                {"message": "User clicked save"},
                {"message": "Loaded /media/xyz.png"},
            ]
        }
    }
    result = _scrub(event, MagicMock())
    msgs = [bc["message"] for bc in result["breadcrumbs"]["values"]]
    assert msgs == ["User clicked save"]


def test_scrub_tolerates_empty_event():
    """_scrub must not raise on a minimal event dict."""
    result = _scrub({}, MagicMock())
    assert isinstance(result, dict)
