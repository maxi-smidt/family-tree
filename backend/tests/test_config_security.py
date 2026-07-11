import pytest

from app.core.config import settings, validate_production_credentials


def _production_settings(**updates):
    return settings.model_copy(
        update={
            "ENVIRONMENT": "production",
            "SECRET_KEY": "a-unique-production-secret-that-is-long-enough",
            "FIRST_ADMIN_PASSWORD": "strong-admin-password",
            "AUTHENTIK_CLIENT_ID": None,
            "AUTHENTIK_CLIENT_SECRET": None,
            "AUTHENTIK_DISCOVERY_URL": None,
            **updates,
        }
    )


@pytest.mark.parametrize(
    "secret",
    [
        "short",
        "change-me-in-production",
        "change-me-please-generate-a-long-random-value",
        "change-me-but-this-is-still-long-enough-to-sign",
    ],
)
def test_production_rejects_weak_signing_secrets(secret):
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        validate_production_credentials(_production_settings(SECRET_KEY=secret))


@pytest.mark.parametrize(
    "password", ["admin", "change-me", "change-me-to-a-real-password", "too-short"]
)
def test_production_rejects_weak_initial_admin_passwords(password):
    with pytest.raises(RuntimeError, match="FIRST_ADMIN_PASSWORD"):
        validate_production_credentials(
            _production_settings(FIRST_ADMIN_PASSWORD=password)
        )


def test_authentik_only_production_does_not_require_local_admin_password():
    config = _production_settings(
        FIRST_ADMIN_PASSWORD="admin",
        AUTHENTIK_CLIENT_ID="client",
        AUTHENTIK_CLIENT_SECRET="secret",
        AUTHENTIK_DISCOVERY_URL="https://id.example.com/.well-known/openid",
    )
    validate_production_credentials(config)


def test_development_allows_local_placeholders():
    config = _production_settings(
        ENVIRONMENT="development",
        SECRET_KEY="dev",
        FIRST_ADMIN_PASSWORD="admin",
    )
    validate_production_credentials(config)
