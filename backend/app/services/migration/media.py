"""The v2 media-relocation phase (#995): the ``media`` phase body.

Runs after ``app.services.migration.converter.run_conversion`` (the
``converting`` phase, #987), which has already repointed every content row's
``workspace_id`` onto its surviving workspace and recorded the deterministic
source -> target mapping in ``MigrationMapping``. What that bulk column
repoint cannot do is fix up the *string values* that embed the old workspace
id as a path segment — ``Member.image_data``, ``GalleryImage.image_data``,
``DocumentFile.url``, ``DocumentUpload.url``, and every ``/api/media/<old>/
...`` reference nested inside an ``ActivityLog`` delete/undo snapshot or a
``MigrationConflict`` bridge-drift payload — nor can it move the underlying
files, which still live on disk under ``media_root/<old>/``.

For each non-survivor mapping, ``run_media_relocation``:

1. Physically merges the source workspace's media directory into the
   target's (``app.services.media.storage.relocate_workspace_media``),
   deduplicating identical bytes and giving a deterministic, content-derived
   name to any same-named-but-different file.
2. Rewrites every reference using the exact old-url -> new-url mapping that
   move produced, never a blind prefix substitution, so a collision-renamed
   file's references land on its new name and nothing else's do.
3. Records a per-source idempotency key so replaying this for the same run
   after a crash only finishes sources an earlier attempt did not complete;
   already-relocated bytes are recognized as such (matching name and hash)
   by ``relocate_workspace_media`` itself.
4. Folds relocation stats and a live owner-usage recompute into the
   already-created ``MigrationReport`` (see ``converter.run_conversion``,
   which writes ``media_verification={}`` as this phase's placeholder).
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ActivityLog,
    DocumentFile,
    DocumentUpload,
    GalleryImage,
    Member,
    MigrationConflict,
    MigrationIdempotencyKey,
    MigrationMapping,
    MigrationReport,
    MigrationRun,
    Workspace,
)
from app.models.migration import MigrationPhase
from app.services.media.storage import (
    MEDIA_TRASH_DIR_NAME,
    relocate_workspace_media,
    resolve_media_path,
)
from app.services.media.storage_usage import compute_owner_usage
from app.services.unit_of_work import UnitOfWork


class MediaRelocationError(RuntimeError):
    """A migrated media reference failed to resolve after relocation."""


@dataclass
class MediaRelocationSummary:
    workspaces_relocated: int = 0
    files_moved: int = 0
    reports_updated: int = 0


# ---------------------------------------------------------------------------
# Idempotency (shared key format with converter._idempotent_target, scoped to
# the MEDIA phase so a media key can never collide with a converting-phase one)
# ---------------------------------------------------------------------------


def _already_relocated(db: Session, run_id: str, source_workspace_id: str) -> bool:
    key = f"media:{source_workspace_id}"
    return (
        db.get(MigrationIdempotencyKey, (run_id, MigrationPhase.MEDIA, key)) is not None
    )


def _mark_relocated(
    db: Session, run_id: str, source_workspace_id: str, target_workspace_id: str
) -> None:
    db.add(
        MigrationIdempotencyKey(
            run_id=run_id,
            phase=MigrationPhase.MEDIA,
            key=f"media:{source_workspace_id}",
            target_type="workspace",
            target_id=target_workspace_id,
        )
    )


# ---------------------------------------------------------------------------
# Crash-safe journaling of in-progress relocations
#
# A file is gone from its source directory the instant relocate_workspace_media
# moves it — there is no re-scanning our way back to its old URL afterward.
# So the run's own MigrationIdempotencyKey (written only once a source is
# fully done) is not enough on its own: a crash after some files moved but
# before that key commits would otherwise leave their DB references pointing
# at bytes that no longer exist there, with nothing left to notice or retry.
# ``MigrationRun.checkpoint`` — explicitly documented as phase-private resume
# state — is used as a durable, per-file journal instead: relocate_workspace_
# media's on_file_relocated callback commits each mapping the moment that one
# file lands, so replaying after any crash always has the complete picture
# of what already moved, no matter how far the interrupted attempt got.
# ---------------------------------------------------------------------------


def _pending_map(run: MigrationRun, source_workspace_id: str) -> dict[str, str]:
    pending = (run.checkpoint or {}).get("media_pending", {})
    return dict(pending.get(source_workspace_id, {}))


def _journal_callback(db: Session, run: MigrationRun, source_workspace_id: str):
    def _on_file_relocated(old_url: str, new_url: str) -> None:
        checkpoint = dict(run.checkpoint or {})
        pending = dict(checkpoint.get("media_pending", {}))
        source_pending = dict(pending.get(source_workspace_id, {}))
        source_pending[old_url] = new_url
        pending[source_workspace_id] = source_pending
        checkpoint["media_pending"] = pending
        run.checkpoint = checkpoint
        with UnitOfWork(db):
            pass

    return _on_file_relocated


def _clear_pending(run: MigrationRun, source_workspace_id: str) -> None:
    checkpoint = dict(run.checkpoint or {})
    pending = dict(checkpoint.get("media_pending", {}))
    pending.pop(source_workspace_id, None)
    checkpoint["media_pending"] = pending
    run.checkpoint = checkpoint


# ---------------------------------------------------------------------------
# Reference rewriting
# ---------------------------------------------------------------------------


def _rewrite_url_columns(
    db: Session, workspace_id: str, url_map: dict[str, str]
) -> None:
    """Rewrite every media-url column of every content row now living in
    ``workspace_id`` whose value is a key in ``url_map``.

    Scoped by the *target* workspace (not the source) since every affected
    row's ``workspace_id`` was already repointed onto the target by
    ``converter.run_conversion`` before this phase ever runs.
    """
    for member in db.scalars(select(Member).where(Member.workspace_id == workspace_id)):
        if member.image_data in url_map:
            member.image_data = url_map[member.image_data]
    for image in db.scalars(
        select(GalleryImage).where(GalleryImage.workspace_id == workspace_id)
    ):
        if image.image_data in url_map:
            image.image_data = url_map[image.image_data]
    for doc_file in db.scalars(
        select(DocumentFile).where(DocumentFile.workspace_id == workspace_id)
    ):
        if doc_file.url in url_map:
            doc_file.url = url_map[doc_file.url]
    for upload in db.scalars(
        select(DocumentUpload).where(DocumentUpload.workspace_id == workspace_id)
    ):
        if upload.url in url_map:
            upload.url = url_map[upload.url]


def _rewrite_json_value(value: object, url_map: dict[str, str]) -> tuple[object, bool]:
    """Recursively replace any string in ``value`` that is a key of
    ``url_map``. Returns ``(new_value, changed)``."""
    if isinstance(value, str):
        if value in url_map:
            return url_map[value], True
        return value, False
    if isinstance(value, list):
        changed = False
        new_items = []
        for item in value:
            new_item, item_changed = _rewrite_json_value(item, url_map)
            new_items.append(new_item)
            changed = changed or item_changed
        return (new_items if changed else value), changed
    if isinstance(value, dict):
        changed = False
        new_dict = {}
        for k, v in value.items():
            new_v, v_changed = _rewrite_json_value(v, url_map)
            new_dict[k] = new_v
            changed = changed or v_changed
        return (new_dict if changed else value), changed
    return value, False


def _rewrite_activity_snapshots(
    db: Session, workspace_id: str, url_map: dict[str, str]
) -> None:
    """Rewrite media URLs embedded in ``ActivityLog.details`` (delete/undo
    snapshots — ``trashed_media`` lists and frozen ``image_data``/``url``
    field copies), a JSON-encoded ``Text`` column so it must be decoded,
    walked, and re-encoded rather than queried in place."""
    for row in db.scalars(
        select(ActivityLog).where(
            ActivityLog.workspace_id == workspace_id, ActivityLog.details.isnot(None)
        )
    ):
        try:
            details = json.loads(row.details)
        except (TypeError, ValueError):
            continue
        new_details, changed = _rewrite_json_value(details, url_map)
        if changed:
            row.details = json.dumps(new_details)


def _rewrite_conflict_media(
    db: Session, run_id: str, workspace_id: str, url_map: dict[str, str]
) -> None:
    """Rewrite media URLs embedded in this run's ``MigrationConflict.
    conflicting_media`` (the alternate bridge photo #1018 will review)."""
    for conflict in db.scalars(
        select(MigrationConflict).where(
            MigrationConflict.run_id == run_id,
            MigrationConflict.workspace_id == workspace_id,
        )
    ):
        new_media, changed = _rewrite_json_value(conflict.conflicting_media, url_map)
        if changed:
            conflict.conflicting_media = new_media


# ---------------------------------------------------------------------------
# Verification + report update
# ---------------------------------------------------------------------------


def _verify_url_map(url_map: dict[str, str]) -> None:
    """Every rewritten reference must resolve to real bytes on disk.

    A URL keeps its pre-trash, live-style form even once its bytes have been
    moved into ``.trash/`` (see ``storage.trash_media``/``untrash_media``), so
    a reference is considered resolved if it exists at either location.
    ``relocate_workspace_media`` only ever installs a file via an atomic
    rename or a fsynced copy+rename, so neither existing here means the move
    itself failed partway rather than that a reference was mis-rewritten —
    surfacing it as a hard failure keeps the run in a recoverable phase
    instead of silently finalizing over lost media.
    """
    for new_url in url_map.values():
        path = resolve_media_path(new_url)
        if path is None:
            raise MediaRelocationError(
                f"Migrated media reference did not resolve: {new_url}"
            )
        trashed = path.parent / MEDIA_TRASH_DIR_NAME / path.name
        if not path.is_file() and not trashed.is_file():
            raise MediaRelocationError(
                f"Migrated media reference did not resolve: {new_url}"
            )


def _update_report(
    db: Session,
    run_id: str,
    owner_user_id: str,
    source_workspace_id: str,
    stats: dict,
) -> None:
    report = db.scalar(
        select(MigrationReport).where(
            MigrationReport.run_id == run_id,
            MigrationReport.owner_user_id == owner_user_id,
        )
    )
    if report is None:
        # Media relocation only ever runs for a source that
        # converter.run_conversion already wrote a report for its survivor's
        # owner, so this should be unreachable — but never silently drop a
        # verification record if it somehow is.
        return
    report.media_verification = {
        **report.media_verification,
        source_workspace_id: stats,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def run_media_relocation(db: Session, run: MigrationRun) -> MediaRelocationSummary:
    """Run (or safely resume) the media-relocation phase for ``run``.

    Every source workspace's relocation is independently idempotency-keyed,
    so replaying this after a crash only redoes the sources an earlier
    attempt did not finish; ``relocate_workspace_media`` is always called
    again for one of those (never skipped outright), since files it left
    behind in the source directory still need moving — files it already
    journaled (see ``_journal_callback``) are simply absent from that
    directory by then and contribute nothing new. Owner usage is
    recomputed for every workspace this run ever absorbed media into, not
    only ones touched on this particular call, so a replay that finds
    every source already done still leaves the report's recorded usage
    correct rather than stale or missing.
    """
    summary = MediaRelocationSummary()
    owners_touched: set[str] = set()

    mappings = list(
        db.scalars(
            select(MigrationMapping).where(
                MigrationMapping.run_id == run.id, MigrationMapping.is_survivor.is_(False)
            )
        )
    )
    for mapping in mappings:
        source_id = mapping.source_workspace_id
        target_id = mapping.target_workspace_id
        target = db.get(Workspace, target_id)
        if target is None:
            continue  # defensive: the survivor must exist by construction
        owners_touched.add(target.owner_id)

        if _already_relocated(db, run.id, source_id):
            continue

        relocate_workspace_media(
            source_id, target_id, on_file_relocated=_journal_callback(db, run, source_id)
        )
        # The journal (kept current by the callback above) is the complete
        # picture regardless of how much of it this call itself just did —
        # it already carries forward anything a prior crashed attempt moved.
        url_map = _pending_map(run, source_id)

        _rewrite_url_columns(db, target_id, url_map)
        _rewrite_activity_snapshots(db, target_id, url_map)
        _rewrite_conflict_media(db, run.id, target_id, url_map)
        _verify_url_map(url_map)

        stats = {"files_moved": len(url_map), "verified": True}
        _update_report(db, run.id, target.owner_id, source_id, stats)
        _mark_relocated(db, run.id, source_id, target_id)
        _clear_pending(run, source_id)

        summary.workspaces_relocated += 1
        summary.files_moved += len(url_map)
        with UnitOfWork(db):
            pass

    for owner_id in owners_touched:
        report = db.scalar(
            select(MigrationReport).where(
                MigrationReport.run_id == run.id,
                MigrationReport.owner_user_id == owner_id,
            )
        )
        if report is None:
            continue
        usage = compute_owner_usage(db, owner_id)
        report.media_verification = {
            **report.media_verification,
            "owner_usage_after_bytes": usage["media_bytes"],
        }
        summary.reports_updated += 1
    if owners_touched:
        with UnitOfWork(db):
            pass

    return summary
