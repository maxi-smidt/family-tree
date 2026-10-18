"""Single-owner transaction boundary for application commands.

A mutation typically has to: write its rows, record an activity-log entry in
the same transaction, commit, and only then publish SSE events / invalidate
caches. Hand-assembling that sequence in every route makes it easy to publish
before a commit (or after one that failed) or to skip a step. ``UnitOfWork``
makes the ordering structural instead of conventional: side effects queued
with ``after_commit`` cannot run unless the wrapped commit actually succeeds.

Usage::

    with UnitOfWork(db) as uow:
        db.add(story)
        record_activity(db, workspace_id=tree.id, actor=user, action="create", ...)
        uow.after_commit(lambda: publish_workspace_event(db, tree, "entry_added", ...))
        uow.after_commit(
    lambda: publish_workspace_event(db, tree, "content_changed", ...)
)

On a clean exit the session is committed and the queued callbacks run, in
order. On an exception raised inside the block — or by the commit itself —
the session is rolled back, the callbacks are discarded, and the exception
propagates: an event can never be published, nor a cache key invalidated,
for a mutation that didn't land.
"""

from __future__ import annotations

from collections.abc import Callable
from types import TracebackType

from sqlalchemy.orm import Session


class UnitOfWork:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._callbacks: list[Callable[[], None]] = []

    def after_commit(self, callback: Callable[[], None]) -> None:
        """Queue *callback* to run once this unit of work commits successfully."""
        self._callbacks.append(callback)

    def __enter__(self) -> UnitOfWork:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc_type is not None:
            self._db.rollback()
            self._callbacks.clear()
            return
        try:
            self._db.commit()
        except BaseException:
            self._db.rollback()
            self._callbacks.clear()
            raise
        # Drain before running: a callback that re-enters this UnitOfWork
        # (or an instance reused for a later mutation) must never replay
        # callbacks queued by this commit.
        callbacks, self._callbacks = self._callbacks, []
        for callback in callbacks:
            callback()
