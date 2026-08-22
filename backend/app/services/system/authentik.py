"""Authentik (OpenID Connect) integration via Authlib.

The OAuth client is only registered when the required environment variables are
present, so the app runs perfectly fine with local-only authentication.
"""

from authlib.integrations.starlette_client import OAuth

from app.core.config import settings

oauth = OAuth()

AUTHENTIK = "authentik"


def init_oauth() -> None:
    if not settings.authentik_enabled:
        return
    oauth.register(
        name=AUTHENTIK,
        client_id=settings.AUTHENTIK_CLIENT_ID,
        client_secret=settings.AUTHENTIK_CLIENT_SECRET,
        server_metadata_url=settings.AUTHENTIK_DISCOVERY_URL,
        client_kwargs={"scope": settings.AUTHENTIK_SCOPES},
    )


def get_client():
    return oauth.create_client(AUTHENTIK)
