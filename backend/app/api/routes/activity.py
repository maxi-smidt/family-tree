"""Activity / audit log endpoints — list recent changes for a tree, and undo
a single logged delete (issue #762)."""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.activity_query import activity_page, hidden_activity_target_types
from app.api.deps import (
    get_current_user,
    get_readable_tree,
    get_writable_tree,
)
from app.db.session import get_db
from app.models import ActivityLog, Tree, User
from app.schemas.activity import ActivityPageOut, ActivityUndoOut, UndoSkippedItem
from app.services.activity.activity import SNAPSHOT_VERSION, record_activity
from app.services.activity.activity_snapshots import UndoLogDetails
from app.services.activity.activity_undo import CONTENT_DOMAIN, RESTORERS, UndoConflict
from app.services.cache import invalidate_stats
from app.services.event_bus import publish_tree_event
from app.services.media.storage import untrash_media
from app.services.unit_of_work import UnitOfWork

router = APIRouter(
    prefix="/trees/{tree_id}",
    tags=["activity"],
)


@router.get("/activity", response_model=ActivityPageOut)
def list_activity(
    tree: Tree = Depends(get_readable_tree),
    user: User = Depends(get_current_user),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    actor: str | None = Query(default=None),
    action: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> ActivityPageOut:
    """Return an offset-based page of newest-first activity for a tree.

    Accessible to anyone with at least read access (owner, editor, viewer).
    """
    return activity_page(
        db,
        [tree.id],
        limit=limit,
        offset=offset,
        actor=actor,
        action=action,
        target_type=target_type,
        hidden_target_types=hidden_activity_target_types(db, user, [tree.id]),
    )


@router.post(
    "/activity/{entry_id}/undo",
    response_model=ActivityUndoOut,
    response_model_exclude_none=True,
)
def undo_activity(
    entry_id: str,
    tree: Tree = Depends(get_writable_tree),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ActivityUndoOut:
    """Undo a single logged delete by restoring its pre-image snapshot.

    Dispatches on ``details.snapshot.version``; only version 1 is understood
    today. Restores the main row plus every child reference that still
    validates against the tree's current state, skipping (and reporting) the
    rest rather than failing outright — see app.services.activity.activity_undo.
    """
    entry = db.get(ActivityLog, entry_id)
    if entry is None or entry.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Activity entry not found")
    if entry.action != "delete":
        raise HTTPException(status_code=422, detail="Only delete actions can be undone")

    details = json.loads(entry.details) if entry.details else None
    snapshot = (details or {}).get("snapshot")
    if snapshot is None:
        raise HTTPException(status_code=422, detail="Entry has no restorable snapshot")
    if snapshot.get("version") != SNAPSHOT_VERSION:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported snapshot version: {snapshot.get('version')!r}",
        )

    restore = RESTORERS.get(entry.target_type)
    if restore is None:
        raise HTTPException(
            status_code=422, detail=f"'{entry.target_type}' entries cannot be undone"
        )

    try:
        with UnitOfWork(db) as uow:
            result = restore(db, tree, snapshot)
            log_details: UndoLogDetails = {
                "undo_of": entry_id,
                "restored": result.restored,
                "skipped": [s.model_dump(exclude_none=True) for s in result.skipped],
            }
            undo_entry = record_activity(
                db,
                tree_id=tree.id,
                actor=user,
                action="create",
                target_type=entry.target_type,
                target_id=result.main_id,
                target_label=entry.target_label,
                details=log_details,
            )
            db.flush()
            undo_entry_id = undo_entry.id

            # Best-effort, post-commit: a failed or degraded media un-trash
            # (the file already purged by the retention sweep) never rolls
            # back the restore — it only shows up as an extra skip in the
            # response the caller sees.
            skipped = list(result.skipped)

            def _untrash_and_report() -> None:
                for url in result.media_to_untrash:
                    if not untrash_media(url):
                        skipped.append(
                            UndoSkippedItem(
                                table="media",
                                reason="file already purged from trash",
                                id=url,
                            )
                        )

            uow.after_commit(_untrash_and_report)
            uow.after_commit(
                lambda: publish_tree_event(
                    db, tree, "activity.entry_added", {"tree_id": tree.id}
                )
            )
            uow.after_commit(
                lambda: publish_tree_event(
                    db,
                    tree,
                    "tree.content_changed",
                    {"tree_id": tree.id, "domain": CONTENT_DOMAIN[entry.target_type]},
                )
            )
            uow.after_commit(lambda: invalidate_stats(tree.id))
    except UndoConflict as exc:
        raise HTTPException(status_code=409, detail=exc.reason) from exc
    except IntegrityError as exc:
        raise HTTPException(
            status_code=409,
            detail="Concurrent conflict — the row was recreated by another request",
        ) from exc

    return ActivityUndoOut(
        undo_entry_id=undo_entry_id,
        target_type=entry.target_type,
        restored=result.restored,
        skipped=skipped,
    )
