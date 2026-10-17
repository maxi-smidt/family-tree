"""Tests for the public migration status contract (#1020)."""

from app.models.migration import MigrationPhase, MigrationRun, MigrationStatus
from app.services.migration.status import public_migration_status


def _run(**kw) -> MigrationRun:
    defaults = {
        "id": "run-1",
        "source_version": "v1",
        "target_version": "2.0.0",
        "heartbeat_at": "2026-01-01T00:00:00Z",
    }
    return MigrationRun(**{**defaults, **kw})


def test_no_run_reports_preflight():
    body = public_migration_status(None)
    assert body == {
        "status": "preflight",
        "run_id": None,
        "phase_heartbeat_at": None,
        "failure_code": None,
        "phase_index": 0,
        "phase_count": 5,
    }


def test_running_backup_phase_maps_to_backup():
    body = public_migration_status(
        _run(status=MigrationStatus.RUNNING, phase=MigrationPhase.BACKUP)
    )
    assert body["status"] == "backup"
    assert body["failure_code"] is None


def test_converting_and_media_both_map_to_migrating():
    converting = public_migration_status(
        _run(status=MigrationStatus.RUNNING, phase=MigrationPhase.CONVERTING)
    )
    media = public_migration_status(
        _run(status=MigrationStatus.RUNNING, phase=MigrationPhase.MEDIA)
    )
    assert converting["status"] == media["status"] == "migrating"
    assert converting["phase_index"] < media["phase_index"]


def test_recoverable_reports_its_stalled_phase_not_failed():
    body = public_migration_status(
        _run(status=MigrationStatus.RECOVERABLE, phase=MigrationPhase.VALIDATING)
    )
    assert body["status"] == "validating"
    assert body["failure_code"] is None


def test_failed_run_surfaces_the_sanitized_code_only():
    body = public_migration_status(
        _run(
            status=MigrationStatus.FAILED,
            phase=MigrationPhase.CONVERTING,
            failure_code="disk_full",
            failure_detail="/data/appdata/backups/pre_migration.ftbackup: ENOSPC",
        )
    )
    assert body["status"] == "failed"
    assert body["failure_code"] == "disk_full"
    assert "failure_detail" not in body
    assert "ENOSPC" not in str(body)


def test_complete_and_finalized_both_report_complete():
    complete = public_migration_status(
        _run(status=MigrationStatus.COMPLETE, phase=MigrationPhase.VALIDATING)
    )
    finalized = public_migration_status(
        _run(status=MigrationStatus.FINALIZED, phase=MigrationPhase.VALIDATING)
    )
    assert complete["status"] == finalized["status"] == "complete"


def test_never_includes_workspace_or_member_identifiers():
    body = public_migration_status(
        _run(status=MigrationStatus.RUNNING, phase=MigrationPhase.CONVERTING)
    )
    assert set(body) == {
        "status",
        "run_id",
        "phase_heartbeat_at",
        "failure_code",
        "phase_index",
        "phase_count",
    }
