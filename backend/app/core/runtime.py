"""Holder for the application's running asyncio event loop.

Sync FastAPI route handlers run in a threadpool and occasionally need to
schedule a coroutine on the main event loop (e.g. fire-and-forget Redis
work) via ``asyncio.run_coroutine_threadsafe``.  They obtain the loop from
here rather than reaching into another service's internals.

The loop is registered once from the lifespan startup and cleared on
shutdown.  ``get_loop()`` returns ``None`` before startup or after
shutdown, so callers must treat a missing loop as "skip".
"""

from __future__ import annotations

import asyncio

_loop: asyncio.AbstractEventLoop | None = None
_startup_complete = False


def set_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    """Register (or clear) the running event loop. Called from lifespan."""
    global _loop  # noqa: PLW0603
    _loop = loop


def get_loop() -> asyncio.AbstractEventLoop | None:
    """Return the registered event loop, or ``None`` if unavailable."""
    return _loop


def set_startup_complete(value: bool) -> None:
    """Flip whether ``app.db.init_db.init_db`` (migrations + the v2 startup
    conversion, see ``app.services.migration.orchestrator``) has finished.

    Read by ``app.main.StartupGateMiddleware`` and ``/health/ready`` so
    ordinary routes stay unavailable — and readiness stays false — for as
    long as that background startup work is still running (#1020), while
    ``/health`` and ``/health/migration`` stay reachable throughout.
    """
    global _startup_complete  # noqa: PLW0603
    _startup_complete = value


def is_startup_complete() -> bool:
    return _startup_complete
