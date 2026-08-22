"""Ownership-transfer undo window.

Shared by the transfer routes (to compute the undo deadline returned to the
client) and the lifecycle routes (deletion is blocked while a transfer can
still be undone).
"""

from datetime import UTC, datetime, timedelta

from app.models import Tree

TRANSFER_UNDO_WINDOW_SECONDS = 60


def undo_deadline(transferred_at: str) -> str:
    dt = datetime.fromisoformat(transferred_at)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return (dt + timedelta(seconds=TRANSFER_UNDO_WINDOW_SECONDS)).isoformat()


def within_undo_window(tree: Tree) -> bool:
    """Return True if the transfer undo window is still open."""
    if tree.previous_owner_id is None or tree.ownership_transferred_at is None:
        return False
    transferred_at = datetime.fromisoformat(tree.ownership_transferred_at)
    if transferred_at.tzinfo is None:
        transferred_at = transferred_at.replace(tzinfo=UTC)
    elapsed = (datetime.now(UTC) - transferred_at).total_seconds()
    return elapsed <= TRANSFER_UNDO_WINDOW_SECONDS
