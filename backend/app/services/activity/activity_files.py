"""Best-effort JSON Lines mirrors of newly committed workspace activity.

Capture rows after flush (when generated ids/timestamps exist), but append only
after the outer transaction commits. Savepoint commits merge into their parent;
rollback/close discards pending entries. The database remains authoritative:
file errors are reported to the backend logger, and a crash between commit and
append can leave a gap. Historical rows and bulk backup restores are not replayed.
"""

import fcntl
import logging
import re
from collections import defaultdict

from sqlalchemy import event, select
from sqlalchemy.orm import Session, SessionTransaction

from app.core.config import settings
from app.models.activity import ActivityLog
from app.models.setting import AppSetting
from app.schemas.activity import ActivityOut

logger = logging.getLogger(__name__)
_PENDING_KEY = "workspace_activity_files"
_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
PendingEntries = dict[SessionTransaction, list[tuple[str, str]]]


def append_activity(workspace_id: str, lines: list[str]) -> None:
    """Append one transaction's entries under an inter-process file lock.

    No fsync: the OS caches the small sequential writes, avoiding a physical
    HDD sync for every change. Closing flushes Python's buffer before releasing
    the lock. No persistent handles, background threads, or unbounded queues.
    """
    if not _SAFE_ID.fullmatch(workspace_id):
        raise ValueError("Invalid workspace id for audit storage")
    root = settings.workspace_log_root.resolve()
    directory = (root / workspace_id).resolve()
    if directory.parent != root:
        raise ValueError("Invalid workspace id for audit storage")
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "activity.jsonl"
    if path.is_symlink():
        raise ValueError("Audit file must not be a symlink")
    payload = ("\n".join(lines) + "\n").encode("utf-8")
    with path.open("ab") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        stream.write(payload)
        # Closing the file flushes while the exclusive lock is still held.


def _capture_activity(db: Session, _flush_context: object) -> None:
    rows = [row for row in db.new if isinstance(row, ActivityLog)]
    if not rows:
        return
    # Read in the mutation's transaction: after_commit cannot issue SQL. Select
    # the scalar directly so a long-lived session's identity map cannot retain
    # an old admin setting after another worker toggles it.
    enabled = db.scalar(
        select(AppSetting.value).where(AppSetting.key == "workspace_audit_files_enabled")
    )
    if enabled != "true":
        return
    entries = [
        (row.workspace_id, ActivityOut.model_validate(row).model_dump_json())
        for row in rows
    ]
    if entries:
        transaction = db.get_nested_transaction() or db.get_transaction()
        assert transaction is not None
        pending: PendingEntries = db.info.setdefault(_PENDING_KEY, {})
        pending.setdefault(transaction, []).extend(entries)


def _write_committed_activity(db: Session) -> None:
    pending: PendingEntries = db.info.get(_PENDING_KEY, {})
    transaction = db.get_nested_transaction() or db.get_transaction()
    entries = pending.pop(transaction, [])
    if not entries:
        return
    if transaction is not None and transaction.nested:
        assert transaction.parent is not None
        pending.setdefault(transaction.parent, []).extend(entries)
        return
    by_workspace: dict[str, list[str]] = defaultdict(list)
    for workspace_id, line in entries:
        by_workspace[workspace_id].append(line)
    for workspace_id, lines in by_workspace.items():
        try:
            append_activity(workspace_id, lines)
        except (OSError, ValueError):
            # The DB commit already succeeded: a full/unwritable disk must not
            # turn the successful mutation into a misleading HTTP failure.
            logger.exception("Failed to append workspace audit file for %s", workspace_id)


def _discard_activity(db: Session, transaction: SessionTransaction) -> None:
    pending: PendingEntries = db.info.get(_PENDING_KEY, {})
    pending.pop(transaction, None)
    if not pending:
        db.info.pop(_PENDING_KEY, None)


def install_activity_file_hooks() -> None:
    """Register once for request, background-job, and script sessions alike."""
    for name, listener in (
        ("after_flush", _capture_activity),
        ("after_commit", _write_committed_activity),
        ("after_transaction_end", _discard_activity),
    ):
        if not event.contains(Session, name, listener):
            event.listen(Session, name, listener)
