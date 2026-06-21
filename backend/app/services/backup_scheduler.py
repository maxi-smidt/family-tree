"""Background loop that periodically creates encrypted instance backups.

Started from the FastAPI ``lifespan`` (app.main). Mirrors the pattern of
``deletion_sweeper.py``: runs in a worker thread via asyncio.to_thread, checks
every hour whether a scheduled backup is due, and never raises into the loop.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import BackupRecord
from app.services import backup_service
from app.services.event_bus import admin_user_ids, event_bus
from app.services.settings_service import get_settings_out

logger = logging.getLogger("app.backup_scheduler")

# How often the loop wakes up to check whether a backup is due.
BACKUP_CHECK_INTERVAL_SECONDS = 3600  # 1 hour


async def backup_schedule_loop() -> None:
    """Run the scheduled-backup check on a fixed interval forever."""
    while True:
        try:
            await asyncio.to_thread(_run_if_due)
        except Exception:  # noqa: BLE001 - a failed check must not kill the loop
            logger.exception("Scheduled backup check failed")
        await asyncio.sleep(BACKUP_CHECK_INTERVAL_SECONDS)


def _run_if_due() -> None:
    with SessionLocal() as db:
        app_settings = get_settings_out(db)
        if not app_settings.backup_schedule_enabled:
            return

        interval = timedelta(hours=app_settings.backup_interval_hours)

        last = db.scalars(
            select(BackupRecord)
            .where(
                BackupRecord.status == "success",
                BackupRecord.trigger == "scheduled",
            )
            .order_by(BackupRecord.created_at.desc())
        ).first()

        if last is not None:
            last_dt = datetime.fromisoformat(last.created_at)
            if datetime.now(UTC) - last_dt < interval:
                return

        logger.info("Scheduled backup is due — starting")
        record = backup_service.create_backup(db, trigger="scheduled")
        backup_service.prune_backups(db, keep=app_settings.backup_retention_count)
        if record.status == "success":
            event_bus.publish(
                admin_user_ids(db),
                "backup.completed",
                {"trigger": "scheduled", "filename": record.filename},
            )
