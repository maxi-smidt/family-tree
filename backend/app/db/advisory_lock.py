"""Best-effort Postgres advisory locks for single-leader background work.

When the backend runs with multiple uvicorn workers (``WORKERS > 1``) every
worker process starts its own copy of the background loops
(:mod:`app.services.system.deletion_sweeper`,
:mod:`app.services.system.backups.backup_scheduler`).
Wrapping a run in :func:`single_leader` ensures only one worker actually does
the work each round: the others fail to acquire the lock and skip. No external
coordinator (Redis, etc.) is needed — Postgres is always present.

The session-level advisory lock is held on a **dedicated connection** for the
duration of the ``with`` block and released on exit, so it never gets tangled
up with the work session's own transactions/commits. A crash frees it when the
connection drops.

This degrades to "run it" when the backend has no advisory-lock support (e.g.
the SQLite test database) or the connection fails, so single-process behavior —
and the unit tests — are unaffected.

:func:`exclusive_lock` is the opposite trade-off, used by the v2 startup
migration orchestrator (#994): it *blocks* until the lock is free rather than
skipping, and treats missing advisory-lock support as fatal rather than a
reason to degrade — a migration must never proceed believing it has exclusivity
when it does not.
"""

import contextlib
import logging
from collections.abc import Iterator

from sqlalchemy import text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


class AdvisoryLockUnavailableError(RuntimeError):
    """Raised by :func:`exclusive_lock` when the lock cannot be trusted."""


@contextlib.contextmanager
def single_leader(key: int, *, engine: Engine | None = None) -> Iterator[bool]:
    """Yield ``True`` if this process won the leader election for ``key``.

    Yields ``False`` (without blocking) when another process holds the lock, so
    the caller can skip the work. Degrades to ``True`` when advisory locks are
    unsupported or the database is unreachable. ``engine`` defaults to the
    application engine; tests pass their own.
    """
    if engine is None:
        from app.db.session import engine as default_engine

        engine = default_engine

    try:
        conn = engine.connect()
    except Exception:
        logger.debug(
            "single_leader: could not connect (key=%s); proceeding", key, exc_info=True
        )
        yield True
        return

    held = False
    degraded = False
    try:
        try:
            held = bool(
                conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key}).scalar()
            )
        except Exception:
            # No advisory-lock support (e.g. SQLite) or a transient DB error —
            # leader election is best-effort, so fall back to running the work.
            degraded = True
            logger.debug(
                "single_leader: advisory lock unavailable (key=%s); proceeding",
                key,
                exc_info=True,
            )
        yield held or degraded
    finally:
        if held:
            with contextlib.suppress(Exception):
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
        conn.close()


@contextlib.contextmanager
def exclusive_lock(key: int, *, engine: Engine | None = None) -> Iterator[None]:
    """Block until the session-level advisory lock ``key`` is held, then run
    the body under it.

    Unlike :func:`single_leader`, this never yields without the lock: a
    missing connection or missing advisory-lock support (e.g. SQLite) raises
    :class:`AdvisoryLockUnavailableError` instead of degrading to "run it
    anyway", since a caller relying on exclusivity (the startup migration)
    must fail closed rather than risk two processes converting concurrently.
    """
    if engine is None:
        from app.db.session import engine as default_engine

        engine = default_engine

    try:
        conn = engine.connect()
    except Exception as exc:
        raise AdvisoryLockUnavailableError(
            f"Could not connect to acquire advisory lock {key}"
        ) from exc

    try:
        try:
            conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": key})
        except Exception as exc:
            raise AdvisoryLockUnavailableError(
                f"Advisory lock {key} is unsupported by this database"
            ) from exc
        try:
            yield
        finally:
            with contextlib.suppress(Exception):
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
    finally:
        conn.close()
