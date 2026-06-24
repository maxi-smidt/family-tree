"""FastAPI application entrypoint."""

import asyncio
import contextlib
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from starlette.middleware.sessions import SessionMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.logging_config import setup_logging
from app.db.init_db import init_db
from app.db.redis import close_redis, ping_redis
from app.db.session import engine
from app.services.authentik import init_oauth
from app.services.backup_scheduler import backup_schedule_loop
from app.services.deletion_sweeper import deletion_sweep_loop
from app.services.storage import InvalidImageURL

setup_logging()
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
    from app.services.event_bus import event_bus

    event_bus.set_loop(asyncio.get_running_loop())
    init_oauth()
    _init_db_with_retry()
    sweeper = asyncio.create_task(deletion_sweep_loop())
    backup_scheduler = asyncio.create_task(backup_schedule_loop())

    # Start the Redis SSE listener when Redis is configured.  This creates a
    # dedicated pub/sub connection and begins feeding local queues from Redis
    # channel messages, enabling multi-worker deployments.
    if settings.redis_enabled:
        await event_bus.start_redis_listener()

    try:
        yield
    finally:
        sweeper.cancel()
        backup_scheduler.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweeper
        with contextlib.suppress(asyncio.CancelledError):
            await backup_scheduler
        # Stop the Redis listener before closing the client.
        if settings.redis_enabled:
            await event_bus.stop_redis_listener()
        await close_redis()


app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION, lifespan=lifespan)

app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

settings.media_root.mkdir(parents=True, exist_ok=True)

app.include_router(api_router, prefix=settings.API_PREFIX)


@app.exception_handler(InvalidImageURL)
async def invalid_image_url_handler(request: Request, exc: InvalidImageURL):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Log the full traceback for any unhandled error and return JSON so the
    frontend gets a useful message instead of an opaque text/plain 500."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get(f"{settings.API_PREFIX}/health", tags=["health"])
def health():
    return {
        "status": "ok",
        "version": settings.APP_VERSION,
        "revision": settings.APP_REVISION,
        "build_date": settings.APP_BUILD_DATE,
    }


@app.get(f"{settings.API_PREFIX}/health/ready", tags=["health"])
async def health_ready():
    # --- database check -------------------------------------------------------
    db_ok = True
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    body: dict = {
        "status": "ok" if db_ok else "error",
        "db": "ok" if db_ok else "unavailable",
    }

    # --- redis check (only when configured) -----------------------------------
    if settings.redis_enabled:
        redis_ok = await ping_redis()
        body["redis"] = "ok" if redis_ok else "unavailable"
        if not redis_ok:
            body["status"] = "error"

    if body["status"] == "error":
        return JSONResponse(status_code=503, content=body)
    return body
