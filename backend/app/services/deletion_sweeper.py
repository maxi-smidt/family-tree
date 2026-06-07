"""Background loop that periodically purges expired pending-deletion users.

Started from the FastAPI ``lifespan`` ([app.main]). It runs one sweep at startup
and then every ``DELETION_SWEEP_INTERVAL_SECONDS``. The purge itself is sync
([user_purge.purge_due_users]) and runs in a worker thread so it never blocks the
event loop. A single task means runs can't overlap.
"""

import asyncio
import logging

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.user_purge import purge_due_users

logger = logging.getLogger("app.deletion_sweeper")


def _run_sweep_once() -> None:
    with SessionLocal() as db:
        purge_due_users(db)


async def deletion_sweep_loop() -> None:
    """Run the purge sweep at startup and then on a fixed interval forever."""
    while True:
        try:
            await asyncio.to_thread(_run_sweep_once)
        except Exception:  # noqa: BLE001 - a failed sweep must not kill the loop
            logger.exception("Deletion sweep failed")
        await asyncio.sleep(settings.DELETION_SWEEP_INTERVAL_SECONDS)
