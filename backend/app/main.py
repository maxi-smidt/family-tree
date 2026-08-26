"""FastAPI application entrypoint."""

import asyncio
import contextlib
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.api.exception_handlers import install_domain_error_handler
from app.api.router import api_router
from app.core import runtime
from app.core.config import settings, validate_production_credentials
from app.core.logging_config import setup_logging
from app.core.schema_epoch import (
    SCHEMA_EPOCH,
    SCHEMA_EPOCH_HEADER,
    SCHEMA_EPOCH_MISMATCH_DETAIL,
)
from app.db.init_db import init_db
from app.db.redis import close_redis, ping_redis
from app.db.session import SessionLocal, engine
from app.models.migration import MigrationRun
from app.services.collaboration import presence_service
from app.services.media.storage import (
    InvalidImageURL,
    cleanup_document_upload_temps,
    cleanup_image_upload_temps,
)
from app.services.migration.status import public_migration_status
from app.services.system.authentik import init_oauth
from app.services.system.backups.backup_scheduler import backup_schedule_loop
from app.services.system.deletion_sweeper import deletion_sweep_loop

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

    validate_production_credentials()

    loop = asyncio.get_running_loop()
    event_bus.set_loop(loop)
    runtime.set_loop(loop)
    runtime.set_startup_complete(False)

    # Multi-worker deployments need Redis pub/sub to fan SSE events across
    # workers; without it, events published by one worker never reach clients
    # connected to another. Warn loudly rather than failing — the app still
    # serves requests, only cross-worker real-time updates are affected.
    if settings.WORKERS > 1 and not settings.redis_enabled:
        logger.warning(
            "WORKERS=%s but REDIS_URL is not set — SSE events will not be "
            "delivered across workers. Set REDIS_URL or run with WORKERS=1.",
            settings.WORKERS,
        )

    sweeper: asyncio.Task | None = None
    backup_scheduler: asyncio.Task | None = None

    async def _startup() -> None:
        nonlocal sweeper, backup_scheduler
        init_oauth()
        cleanup_document_upload_temps()
        cleanup_image_upload_temps()
        # Off the event loop and thread, so it doesn't block ASGI request
        # handling: a v1->v2 conversion (app.services.migration.orchestrator)
        # can run for minutes, and /api/health + /api/health/migration must
        # stay reachable throughout (#1020). StartupGateMiddleware below
        # keeps every other route unavailable until this completes.
        await run_in_threadpool(_init_db_with_retry)
        sweeper = asyncio.create_task(deletion_sweep_loop())
        backup_scheduler = asyncio.create_task(backup_schedule_loop())
        # Start the Redis SSE listener when Redis is configured.  This
        # creates a dedicated pub/sub connection and begins feeding local
        # queues from Redis channel messages, enabling multi-worker
        # deployments.
        if settings.redis_enabled:
            await event_bus.start_redis_listener()
        runtime.set_startup_complete(True)

    startup_task = asyncio.create_task(_startup())

    try:
        yield
    finally:
        # A cancel here can't actually stop `_init_db_with_retry` mid-flight
        # (it's a plain sync call in a worker thread, and Python threads
        # aren't preemptible) — it only stops `_startup` from proceeding past
        # its next `await` once the thread call returns. That's fine: the
        # migration holds its own advisory lock and commits its own progress,
        # so letting it finish (or fail) on its own is safe either way.
        startup_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await startup_task
        if sweeper is not None:
            sweeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sweeper
        if backup_scheduler is not None:
            backup_scheduler.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await backup_scheduler
        # Stop the Redis listener before closing the client. This must run
        # before event_bus.reset() below — it's what cancels and awaits the
        # listener task and closes the pubsub connection; reset() only clears
        # already-quiesced references, it does not tear anything down itself.
        # Safe even if _startup never reached start_redis_listener() —
        # stop_redis_listener() is a no-op with no listener task running.
        if settings.redis_enabled:
            await event_bus.stop_redis_listener()
        await close_redis()
        runtime.set_loop(None)
        runtime.set_startup_complete(False)
        # Drop subscriber/loop state so a subsequent lifespan in this same
        # process (tests build the FastAPI app more than once) starts clean.
        # Deliberately not done on startup: this app instance's shutdown is
        # what guarantees the state is quiescent, not the next instance's
        # startup — resetting on startup would race an overlapping shutdown.
        event_bus.reset()
        presence_service.reset()


app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION, lifespan=lifespan)

# Auth and health are exempt: a frontend must be able to learn the current
# epoch (GET /auth/config) and bootstrap a session before it has anything to
# declare, and neither route touches workspace-shaped data.
_SCHEMA_EPOCH_EXEMPT_PREFIXES = (
    f"{settings.API_PREFIX}/auth",
    f"{settings.API_PREFIX}/health",
)
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class SchemaEpochMiddleware(BaseHTTPMiddleware):
    """Fails a mutation closed instead of applying it under the wrong wire
    contract — a stale cached v1 frontend never sends this header at all, and
    a frontend built for a different epoch than this backend sends a value
    that won't match (see app.core.schema_epoch)."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if (
            request.method not in _SAFE_METHODS
            and path.startswith(settings.API_PREFIX)
            and not path.startswith(_SCHEMA_EPOCH_EXEMPT_PREFIXES)
            and request.headers.get(SCHEMA_EPOCH_HEADER) != str(SCHEMA_EPOCH)
        ):
            return JSONResponse(
                status_code=409, content={"detail": SCHEMA_EPOCH_MISMATCH_DETAIL}
            )
        return await call_next(request)


_STARTUP_GATE_EXEMPT_PREFIXES = (f"{settings.API_PREFIX}/health",)


class StartupGateMiddleware(BaseHTTPMiddleware):
    """Keeps ordinary routes unavailable until the startup migration
    finishes (#1020) — reading Workspace/Member rows mid-v1->v2-conversion
    would see a torn state. Only /health* stays reachable throughout, so a
    maintenance screen can poll progress while this gate is up."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if (
            path.startswith(settings.API_PREFIX)
            and not path.startswith(_STARTUP_GATE_EXEMPT_PREFIXES)
            and not runtime.is_startup_complete()
        ):
            return JSONResponse(
                status_code=503, content={"detail": "startup_in_progress"}
            )
        return await call_next(request)


app.add_middleware(StartupGateMiddleware)
app.add_middleware(SchemaEpochMiddleware)
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
install_domain_error_handler(app)


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
        "schema_epoch": SCHEMA_EPOCH,
    }


def _check_db() -> bool:
    """Blocking DB liveness probe. Run in a threadpool — never on the loop."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@app.get(f"{settings.API_PREFIX}/health/ready", tags=["health"])
async def health_ready():
    # Readiness is false for as long as the startup migration is running —
    # see /health/migration for what it's doing. Checked before the DB probe
    # below: a v1->v2 conversion holds its own connection/lock, and probing
    # the pool concurrently adds nothing useful while it's in progress.
    if not runtime.is_startup_complete():
        return JSONResponse(
            status_code=503, content={"status": "starting", "db": "unknown"}
        )

    # --- database check -------------------------------------------------------
    # engine.connect() is blocking and can stall for the pool-checkout/connect
    # timeout when Postgres is slow or down — exactly when readiness probes
    # fire most. Offload to the threadpool so it never blocks the event loop
    # (which would stall every in-flight request and SSE stream on this worker).
    db_ok = await run_in_threadpool(_check_db)

    body: dict = {
        "status": "ok" if db_ok else "error",
        "db": "ok" if db_ok else "unavailable",
    }

    # --- redis check (only when configured) -----------------------------------
    # Redis is optional: an outage degrades readiness rather than failing it,
    # unless REDIS_REQUIRED opts into treating it as a hard dependency.
    if settings.redis_enabled:
        redis_ok = await ping_redis()
        body["redis"] = "ok" if redis_ok else "unavailable"
        if not redis_ok and body["status"] != "error":
            body["status"] = "error" if settings.REDIS_REQUIRED else "degraded"

    if body["status"] == "error":
        return JSONResponse(status_code=503, content=body)
    return body


def _latest_migration_run() -> MigrationRun | None:
    """Blocking read. Run in a threadpool — never on the loop.

    Uses its own short-lived session rather than a ``get_db`` dependency: this
    route must answer even before the startup migration (and thus
    ``migration_runs`` itself, on a first v1->v2 upgrade) exists, so a
    missing table is treated the same as no run yet rather than a 500.
    """
    try:
        with SessionLocal() as db:
            return db.scalars(
                select(MigrationRun).order_by(MigrationRun.started_at.desc()).limit(1)
            ).first()
    except Exception:
        return None


@app.get(f"{settings.API_PREFIX}/health/migration", tags=["health"])
async def health_migration():
    """Non-sensitive v2 migration status (#1020): safe to poll from an
    unauthenticated maintenance screen while StartupGateMiddleware keeps
    every other route unavailable. See app.services.migration.status for
    what is (and deliberately isn't) included."""
    run = await run_in_threadpool(_latest_migration_run)
    return public_migration_status(run)
