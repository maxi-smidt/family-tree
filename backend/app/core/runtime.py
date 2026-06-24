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


def set_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    """Register (or clear) the running event loop. Called from lifespan."""
    global _loop  # noqa: PLW0603
    _loop = loop


def get_loop() -> asyncio.AbstractEventLoop | None:
    """Return the registered event loop, or ``None`` if unavailable."""
    return _loop
