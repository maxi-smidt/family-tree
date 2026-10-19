"""Audit mirrors follow transactions and stay intact across concurrent writers."""

import json
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings, settings
from app.models.activity import ActivityLog
from app.models.admin_audit import AdminAuditLog
from app.models.setting import AppSetting
from app.schemas.activity import ActivityOut
from app.services.activity.activity import record_activity
from app.services.activity.activity_files import append_activity
from app.services.system.settings_service import set_setting
from tests.conftest import API, auth, make_tree, make_user


@pytest.fixture(autouse=True)
def enable_workspace_audit_files(db, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path / "data")
    set_setting(db, "workspace_audit_files_enabled", "true")
    db.commit()


def _record(db, tree, owner, **updates):
    return record_activity(
        db,
        workspace_id=tree.id,
        actor=owner,
        action="create",
        target_type="member",
        **updates,
    )


def _path(tree):
    return settings.workspace_log_root / tree.id / "activity.jsonl"


def _entries(tree):
    return [json.loads(line) for line in _path(tree).read_text().splitlines()]


def test_file_matches_activity_api_after_commit(db, tree, owner):
    row = _record(db, tree, owner, target_label="Ada\nMüller", details={"before": "é"})
    db.flush()
    assert not _path(tree).exists()
    db.commit()

    assert _entries(tree) == [ActivityOut.model_validate(row).model_dump()]
    assert len(_path(tree).read_text().splitlines()) == 1
    # Read-only commits must not replay entries.
    db.commit()
    assert len(_entries(tree)) == 1


@pytest.mark.parametrize("stored_value", [None, "false"])
def test_disabled_by_default_without_affecting_database_activity(
    db, tree, owner, stored_value
):
    db.execute(
        delete(AppSetting).where(AppSetting.key == "workspace_audit_files_enabled")
    )
    if stored_value is not None:
        set_setting(db, "workspace_audit_files_enabled", stored_value)
    db.commit()
    row = _record(db, tree, owner)
    db.commit()
    assert db.get(ActivityLog, row.id) is row
    assert not settings.workspace_log_root.exists()


def test_admin_toggle_applies_without_restart_and_keeps_written_history(
    client, db, tree, owner
):
    admin = make_user(db, "admin", is_admin=True)
    db.execute(
        delete(AppSetting).where(AppSetting.key == "workspace_audit_files_enabled")
    )
    db.commit()
    response = client.get(f"{API}/settings", headers=auth(admin))
    assert response.status_code == 200
    assert response.json()["workspace_audit_files_enabled"] is False

    _record(db, tree, owner)
    db.commit()
    assert not _path(tree).exists()

    response = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"workspace_audit_files_enabled": True},
    )
    assert response.status_code == 200
    assert response.json()["workspace_audit_files_enabled"] is True
    cached = db.get(AppSetting, "workspace_audit_files_enabled")
    assert cached.value == "true"
    kept = _record(db, tree, owner)
    db.commit()
    assert [entry["id"] for entry in _entries(tree)] == [kept.id]
    before = _path(tree).read_bytes()

    response = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"workspace_audit_files_enabled": False},
    )
    assert response.status_code == 200
    assert response.json()["workspace_audit_files_enabled"] is False
    # This session still holds the old ORM object. The mirror must read the
    # current DB value changed through another request/session.
    assert cached.value == "true"
    _record(db, tree, owner)
    db.commit()
    assert _path(tree).read_bytes() == before
    response = client.patch(
        f"{API}/settings",
        headers=auth(admin),
        json={"workspace_audit_files_enabled": True},
    )
    assert response.status_code == 200
    resumed = _record(db, tree, owner)
    db.commit()
    assert [entry["id"] for entry in _entries(tree)] == [kept.id, resumed.id]
    audits = db.scalars(select(AdminAuditLog).order_by(AdminAuditLog.created_at)).all()
    assert [
        audit.details["changes"]["workspace_audit_files_enabled"] for audit in audits
    ] == [
        {"before": False, "after": True},
        {"before": True, "after": False},
        {"before": False, "after": True},
    ]


def test_regular_user_cannot_enable_audit_files(client, owner):
    assert (
        client.patch(
            f"{API}/settings",
            headers=auth(owner),
            json={"workspace_audit_files_enabled": True},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{API}/settings", json={"workspace_audit_files_enabled": True}
        ).status_code
        == 401
    )


def test_batches_multiple_flushes_by_workspace(db, tree, owner):
    other = make_tree(db, owner)
    with patch(
        "app.services.activity.activity_files.append_activity", wraps=append_activity
    ) as append:
        first = _record(db, tree, owner)
        db.flush()
        second = _record(db, tree, owner)
        third = _record(db, other, owner)
        db.flush()
        db.commit()
    assert append.call_count == 2
    assert [entry["id"] for entry in _entries(tree)] == [first.id, second.id]
    assert [entry["id"] for entry in _entries(other)] == [third.id]


def test_rollback_discards_flushed_entries_and_session_can_be_reused(db, tree, owner):
    _record(db, tree, owner)
    db.flush()
    db.rollback()
    assert not _path(tree).exists()
    kept = _record(db, tree, owner)
    db.commit()
    assert [entry["id"] for entry in _entries(tree)] == [kept.id]


def test_failed_commit_does_not_write_previously_flushed_activity(db, tree, owner):
    _record(db, tree, owner)
    db.flush()
    db.add(
        ActivityLog(
            workspace_id="nonexistent-workspace",
            action="create",
            target_type="member",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    assert not _path(tree).exists()
    assert not list(settings.workspace_log_root.rglob("*.jsonl"))


def test_session_close_discards_pending_activity(db, tree, owner):
    _record(db, tree, owner)
    db.flush()
    db.close()
    kept = _record(db, tree, owner)
    db.commit()
    assert [entry["id"] for entry in _entries(tree)] == [kept.id]


@pytest.mark.parametrize("commit_outer", [False, True])
def test_savepoint_commit_waits_for_outer_commit(db, tree, owner, commit_outer):
    with db.begin_nested():
        row = _record(db, tree, owner)
    assert not _path(tree).exists()
    if commit_outer:
        db.commit()
        assert [entry["id"] for entry in _entries(tree)] == [row.id]
    else:
        db.rollback()
        assert not _path(tree).exists()


def test_savepoint_rollback_preserves_only_parent_entries(db, tree, owner):
    first = _record(db, tree, owner)
    db.flush()
    nested = db.begin_nested()
    _record(db, tree, owner)
    db.flush()
    nested.rollback()
    last = _record(db, tree, owner)
    db.commit()
    assert [entry["id"] for entry in _entries(tree)] == [first.id, last.id]


def test_nested_savepoints_merge_without_duplicate_entries(db, tree, owner):
    with db.begin_nested():
        first = _record(db, tree, owner)
        with db.begin_nested():
            second = _record(db, tree, owner)
    db.commit()
    assert [entry["id"] for entry in _entries(tree)] == [first.id, second.id]


def test_disk_error_reports_failure_without_losing_committed_change(
    db, tree, owner, caplog
):
    row = _record(db, tree, owner)
    with patch(
        "app.services.activity.activity_files.append_activity",
        side_effect=PermissionError("audit directory is unwritable"),
    ):
        db.commit()
    assert db.get(ActivityLog, row.id) is row
    assert not _path(tree).exists()
    assert f"Failed to append workspace audit file for {tree.id}" in caplog.text


def test_route_activity_is_mirrored_and_ui_clear_keeps_file(client, tree, headers):
    response = client.post(
        f"{API}/workspaces/{tree.id}/members",
        headers=headers,
        json={"id": "ada", "firstName": "Ada", "lastName": "Doe", "gender": "f"},
    )
    assert response.status_code == 201
    activity = client.get(f"{API}/workspaces/{tree.id}/activity", headers=headers)
    assert activity.status_code == 200
    assert _entries(tree) == activity.json()["entries"]
    before = _path(tree).read_bytes()
    assert (
        client.delete(f"{API}/workspaces/{tree.id}/activity", headers=headers).status_code
        == 204
    )
    assert _path(tree).read_bytes() == before


@pytest.mark.parametrize(
    "workspace_id", ["", ".", "..", "../escape", "/tmp", "a/b", "a\\b"]
)
def test_rejects_unsafe_workspace_paths(workspace_id):
    with pytest.raises(ValueError, match="Invalid workspace id"):
        append_activity(workspace_id, ["{}"])


def test_rejects_workspace_symlink_outside_root(tmp_path):
    root = settings.workspace_log_root
    root.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "workspace").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="Invalid workspace id"):
        append_activity("workspace", ["{}"])
    assert not list(outside.iterdir())


def test_rejects_file_symlink(tmp_path):
    directory = settings.workspace_log_root / "workspace"
    directory.mkdir(parents=True)
    outside = tmp_path / "outside.jsonl"
    (directory / "activity.jsonl").symlink_to(outside)
    with pytest.raises(ValueError, match="symlink"):
        append_activity("workspace", ["{}"])
    assert not outside.exists()


def test_log_root_follows_data_path(tmp_path):
    config = Settings(_env_file=None, DATA_PATH=tmp_path)
    assert config.workspace_log_root == tmp_path / "logs"
    assert config.workspace_log_root.parent == config.media_root.parent


def _append_in_process(data_path: str, worker: int) -> None:
    settings.DATA_PATH = Path(data_path)
    # Larger than a Python file buffer: interleaving would break JSON parsing.
    for batch in range(10):
        append_activity(
            "shared-workspace",
            [json.dumps({"worker": worker, "batch": batch, "value": "ü" * 10_000})],
        )


def test_concurrent_processes_keep_complete_lines():
    with ProcessPoolExecutor(
        max_workers=3, mp_context=multiprocessing.get_context("spawn")
    ) as pool:
        futures = [
            pool.submit(_append_in_process, str(settings.DATA_PATH), worker)
            for worker in range(3)
        ]
        for future in futures:
            future.result(timeout=30)
    path = settings.workspace_log_root / "shared-workspace" / "activity.jsonl"
    entries = [json.loads(line) for line in path.read_text().splitlines()]
    assert len(entries) == 30
    assert {(entry["worker"], entry["batch"]) for entry in entries} == {
        (worker, batch) for worker in range(3) for batch in range(10)
    }
    assert all(entry["value"] == "ü" * 10_000 for entry in entries)
