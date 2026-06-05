"""FastAPI application entrypoint."""

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError
from starlette.middleware.sessions import SessionMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.db.init_db import init_db
from app.services.authentik import init_oauth

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")


def _init_db_with_retry(retries: int = 10, delay: float = 3.0) -> None:
    for attempt in range(1, retries + 1):
        try:
            init_db()
            return
        except OperationalError:
            logger.warning(
                "Database not ready (attempt %s/%s), retrying in %ss",
                attempt,
                retries,
                delay,
            )
            time.sleep(delay)
    init_db()  # final attempt: let the error surface


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_oauth()
    _init_db_with_retry()
    yield


app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION, lifespan=lifespan)

app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded media (member photos, gallery images). Filenames are random
# UUIDs, so the URLs are effectively unguessable.
settings.media_root.mkdir(parents=True, exist_ok=True)
app.mount(
    f"{settings.API_PREFIX}/media",
    StaticFiles(directory=str(settings.media_root)),
    name="media",
)

app.include_router(api_router, prefix=settings.API_PREFIX)


@app.get(f"{settings.API_PREFIX}/health", tags=["health"])
def health():
    return {"status": "ok", "version": settings.APP_VERSION}
