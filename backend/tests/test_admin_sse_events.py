"""SSE events for background admin jobs (issue #415).

Tests cover:
- admin_user_ids() returns only active, non-pending-deletion admins
- backup_scheduler._run_if_due emits backup.completed to admins after success
- deletion_sweeper._run_sweep_once emits purge.ran to admins when users were purged
"""

from unittest.mock import MagicMock, patch

from app.services.event_bus import admin_user_ids
from tests.conftest import make_user

# ---------------------------------------------------------------------------
# admin_user_ids helper
# ---------------------------------------------------------------------------


def test_admin_user_ids_returns_only_active_admins(db):
    admin = make_user(db, "admin", is_admin=True)
    _regular = make_user(db, "regular", is_admin=False)
    _inactive_admin = make_user(db, "inactive_admin", is_admin=True, is_active=False)

    ids = admin_user_ids(db)
    assert ids == [admin.id]


# ---------------------------------------------------------------------------
# backup_scheduler
# ---------------------------------------------------------------------------


def test_scheduled_backup_emits_backup_completed():
    """_run_if_due emits backup.completed when a backup succeeds."""
    mock_record = MagicMock()
    mock_record.status = "success"
    mock_record.filename = "backup_20240101_abcd1234.ftbackup"

    with (
        patch(
            "app.services.system.backups.backup_scheduler.SessionLocal"
        ) as mock_session_cls,
        patch(
            "app.services.system.backups.backup_scheduler.get_settings_out"
        ) as mock_settings,
        patch("app.services.system.backups.backup_scheduler.backup_service") as mock_svc,
        patch("app.services.system.backups.backup_scheduler.event_bus") as mock_bus,
        patch(
            "app.services.system.backups.backup_scheduler.admin_user_ids",
            return_value=["admin-id"],
        ),
    ):
        mock_db = MagicMock()
        mock_session_cls.return_value.__enter__ = lambda s, *a, **k: mock_db
        mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)

        cfg = MagicMock()
        cfg.backup_schedule_enabled = True
        cfg.backup_interval_hours = 24
        cfg.backup_retention_count = 5
        mock_settings.return_value = cfg

        mock_db.scalars.return_value.first.return_value = None  # no prior backup
        mock_svc.create_backup.return_value = mock_record

        from app.services.system.backups.backup_scheduler import _run_if_due

        _run_if_due()

    mock_bus.publish.assert_called_once_with(
        ["admin-id"],
        "backup.completed",
        {"trigger": "scheduled", "filename": mock_record.filename},
    )


def test_failed_backup_does_not_emit():
    """_run_if_due does NOT emit when the backup record status is 'failed'."""
    mock_record = MagicMock()
    mock_record.status = "failed"

    with (
        patch(
            "app.services.system.backups.backup_scheduler.SessionLocal"
        ) as mock_session_cls,
        patch(
            "app.services.system.backups.backup_scheduler.get_settings_out"
        ) as mock_settings,
        patch("app.services.system.backups.backup_scheduler.backup_service") as mock_svc,
        patch("app.services.system.backups.backup_scheduler.event_bus") as mock_bus,
        patch(
            "app.services.system.backups.backup_scheduler.admin_user_ids",
            return_value=["admin-id"],
        ),
    ):
        mock_db = MagicMock()
        mock_session_cls.return_value.__enter__ = lambda s, *a, **k: mock_db
        mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)

        cfg = MagicMock()
        cfg.backup_schedule_enabled = True
        cfg.backup_interval_hours = 24
        cfg.backup_retention_count = 5
        mock_settings.return_value = cfg
        mock_db.scalars.return_value.first.return_value = None
        mock_svc.create_backup.return_value = mock_record

        from app.services.system.backups.backup_scheduler import _run_if_due

        _run_if_due()

    mock_bus.publish.assert_not_called()


# ---------------------------------------------------------------------------
# deletion_sweeper
# ---------------------------------------------------------------------------


def test_sweep_with_purges_emits_purge_ran():
    """_run_sweep_once emits purge.ran when users were removed."""
    with (
        patch("app.services.system.deletion_sweeper.SessionLocal") as mock_session_cls,
        patch("app.services.system.deletion_sweeper.purge_due_users", return_value=2),
        patch("app.services.system.deletion_sweeper.event_bus") as mock_bus,
        patch(
            "app.services.system.deletion_sweeper.admin_user_ids",
            return_value=["admin-id"],
        ),
    ):
        mock_db = MagicMock()
        mock_session_cls.return_value.__enter__ = lambda s, *a, **k: mock_db
        mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)

        from app.services.system.deletion_sweeper import _run_sweep_once

        _run_sweep_once()

    mock_bus.publish.assert_called_once_with(
        ["admin-id"], "purge.ran", {"purged_count": 2}
    )


def test_sweep_with_no_purges_does_not_emit():
    """_run_sweep_once does NOT emit when no users were purged."""
    with (
        patch("app.services.system.deletion_sweeper.SessionLocal") as mock_session_cls,
        patch("app.services.system.deletion_sweeper.purge_due_users", return_value=0),
        patch("app.services.system.deletion_sweeper.event_bus") as mock_bus,
        patch(
            "app.services.system.deletion_sweeper.admin_user_ids",
            return_value=["admin-id"],
        ),
    ):
        mock_db = MagicMock()
        mock_session_cls.return_value.__enter__ = lambda s, *a, **k: mock_db
        mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)

        from app.services.system.deletion_sweeper import _run_sweep_once

        _run_sweep_once()

    mock_bus.publish.assert_not_called()
