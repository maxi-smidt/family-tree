"""Background loop that periodically purges expired pending-deletion users,
trashed media, and stale identity-link proposals.

Started from the FastAPI ``lifespan`` ([app.main]). It runs one sweep at startup
and then every ``DELETION_SWEEP_INTERVAL_SECONDS``. Each purge is sync
([user_purge.purge_due_users], [storage.purge_expired_media_trash]) and runs in
a worker thread so it never blocks the event loop. A single task means runs
can't overlap.

Under multiple uvicorn workers each process runs this loop, so a Postgres
advisory lock ([advisory_lock.single_leader]) elects a single leader per round;
non-leaders skip. With one worker the lock is always free, so it's a no-op.
"""

import asyncio
import logging

from app.core.config import settings
from app.db.advisory_lock import single_leader
from app.db.session import SessionLocal
from app.services.event_bus import admin_user_ids, event_bus
from app.services.identity_link_claims import expire_stale_claims
from app.services.identity_links import expire_stale_proposals
from app.services.media.storage import MEDIA_TRASH_TTL_SECONDS, purge_expired_media_trash
from app.services.system.user_purge import purge_due_users

logger = logging.getLogger("app.deletion_sweeper")

# Stable advisory-lock key for the deletion sweep (distinct from the backup one).
_SWEEP_LOCK_KEY = 0x46540001


def _run_sweep_once() -> None:
    with SessionLocal() as db:
        count = purge_due_users(db)
        if count > 0:
            event_bus.publish(
                admin_user_ids(db),
                "purge.ran",
                {"purged_count": count},
            )
    purged_media = purge_expired_media_trash(MEDIA_TRASH_TTL_SECONDS)
    if purged_media > 0:
        logger.info("Purged %d expired trashed media file(s)", purged_media)
    with SessionLocal() as db:
        expired_links = expire_stale_proposals(db)
        if expired_links > 0:
            logger.info("Expired %d stale identity-link proposal(s)", expired_links)
        expired_claims = expire_stale_claims(db)
        if expired_claims > 0:
            logger.info("Expired %d stale identity-link claim(s)", expired_claims)


def _sweep_if_leader() -> None:
    """Run a sweep only if this process wins the advisory-lock leader election."""
    with single_leader(_SWEEP_LOCK_KEY) as is_leader:
        if not is_leader:
            logger.debug("Another worker holds the deletion-sweep lock; skipping")
            return
        _run_sweep_once()


async def deletion_sweep_loop() -> None:
    """Run the purge sweep at startup and then on a fixed interval forever."""
    while True:
        try:
            await asyncio.to_thread(_sweep_if_leader)
        except Exception:  # noqa: BLE001 - a failed sweep must not kill the loop
            logger.exception("Deletion sweep failed")
        await asyncio.sleep(settings.DELETION_SWEEP_INTERVAL_SECONDS)
