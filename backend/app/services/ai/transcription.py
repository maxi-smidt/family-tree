"""Transcribe one document file with the requesting person's AI provider.

A run starts on an explicit request (never on upload): :func:`start_transcription`
records a ``pending`` :class:`DocumentFileTranscription`, and
:func:`run_transcription` does the provider call in a background task with its
own session. The result fills the file's text (#1121): it always lands in
``machine_markdown``, and in ``markdown`` too unless a person has changed the
text since the last machine version, so a re-run never overwrites an edit.

Runs live in the request's process. A run cut off by a restart stays
``pending`` in the database; once it is older than :data:`STALE_AFTER` it is
reported as failed (``interrupted``) and can be started again.
"""

from __future__ import annotations

import io
import logging
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, InvalidInputError, QuotaExceeded
from app.db.base import utcnow_iso
from app.db.session import SessionLocal
from app.models import (
    Document,
    DocumentFile,
    DocumentFileText,
    DocumentFileTranscription,
    User,
    UserAiSettings,
    Workspace,
)
from app.services.activity.activity import record_activity
from app.services.ai.ai_settings import (
    effective_prompt,
    get_ai_settings,
    is_configured,
    provider_for,
)
from app.services.ai.providers import (
    PROVIDERS,
    AiProviderError,
    TranscriptionInput,
    clean_markdown,
)
from app.services.event_bus import event_bus, publish_workspace_event
from app.services.media.storage import media_file_path
from app.services.media.storage_usage import check_workspace_quota
from app.services.unit_of_work import UnitOfWork

logger = logging.getLogger(__name__)

IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/webp", "image/gif"})
PDF_TYPE = "application/pdf"
TRANSCRIBABLE_TYPES = IMAGE_TYPES | {PDF_TYPE}

# Below the inline-upload limits of Gemini (20 MB) and Anthropic (32 MB).
MAX_SEND_BYTES = 20 * 1024 * 1024
# Longest image side sent; enough for handwriting, small enough for every API.
MAX_IMAGE_SIDE = 4096
# A run still pending after this was cut off (restart, crash).
STALE_AFTER = timedelta(minutes=15)


def _is_stale(run: DocumentFileTranscription) -> bool:
    try:
        updated = datetime.fromisoformat(run.updated_at)
    except ValueError:
        return True
    return datetime.now(UTC) - updated > STALE_AFTER


def run_state(run: DocumentFileTranscription) -> tuple[str, str | None]:
    """``(status, error)`` as people should see it."""
    if run.status == "pending" and _is_stale(run):
        return "failed", "interrupted"
    return run.status, run.error


def transcription_states(
    db: Session, file_ids: Iterable[str]
) -> dict[str, DocumentFileTranscription]:
    """The latest run of each of *file_ids* that has one, in one query."""
    ids = list(file_ids)
    if not ids:
        return {}
    rows = db.scalars(
        select(DocumentFileTranscription).where(
            DocumentFileTranscription.document_file_id.in_(ids)
        )
    )
    return {row.document_file_id: row for row in rows}


def start_transcription(
    db: Session, tree: Workspace, file: DocumentFile, user: User
) -> DocumentFileTranscription:
    """Validate and record a pending run; the caller schedules
    :func:`run_transcription` once this has committed."""
    if file.kind != "file":
        raise InvalidInputError("Links have no text")
    settings = get_ai_settings(db, user)
    if not is_configured(settings):
        raise InvalidInputError("ai_not_configured")
    assert settings is not None
    mime = (file.mime_type or "").lower()
    if not _accepts(settings, mime):
        raise InvalidInputError("unsupported_file")
    existing = db.get(DocumentFileTranscription, file.id)
    if existing is not None and existing.status == "pending" and not _is_stale(existing):
        raise ConflictError("transcription_running")

    now = utcnow_iso()
    with UnitOfWork(db) as uow:
        run = existing or DocumentFileTranscription(
            document_file_id=file.id, workspace_id=tree.id, created_at=now
        )
        run.requested_by = user.id
        run.provider = settings.provider
        run.model = settings.model
        run.status = "pending"
        run.error = None
        run.updated_at = now
        if existing is None:
            db.add(run)
        uow.after_commit(lambda: _publish_changed(db, tree))
    db.refresh(run)
    return run


def _accepts(settings: UserAiSettings, mime: str) -> bool:
    if mime not in TRANSCRIBABLE_TYPES:
        return False
    return mime in IMAGE_TYPES or PROVIDERS[settings.provider].supports_pdf


def run_transcription(file_id: str) -> None:
    """Background task: call the provider and store the result or the failure."""
    db = SessionLocal()
    try:
        _run(db, file_id)
    finally:
        db.close()


def _run(db: Session, file_id: str) -> None:
    run = db.get(DocumentFileTranscription, file_id)
    if run is None or run.status != "pending":
        return
    file = db.get(DocumentFile, file_id)
    tree = db.get(Workspace, run.workspace_id)
    if file is None or tree is None:
        return
    requester_id = run.requested_by
    try:
        markdown = _transcribe(db, run, file)
        _store_result(db, tree, file, run, markdown)
    except AiProviderError as exc:
        _store_failure(db, tree, file, file_id, str(exc))
    except QuotaExceeded:
        _store_failure(db, tree, file, file_id, "quota_exceeded")
    except Exception:
        logger.exception("Transcription of document file %s failed", file_id)
        _store_failure(db, tree, file, file_id, "internal_error")
    finally:
        _notify(db, requester_id, tree.id, file)


def _transcribe(db: Session, run: DocumentFileTranscription, file: DocumentFile) -> str:
    settings = get_ai_settings(db, run.requested_by)
    if settings is None or not is_configured(settings):
        raise AiProviderError("ai_not_configured")
    path = media_file_path(file.url, file.workspace_id)
    if path is None:
        raise AiProviderError("file_missing")
    payload = prepare_input(path, (file.mime_type or "").lower())
    provider = provider_for(settings)
    run.provider = settings.provider
    run.model = settings.model
    text = clean_markdown(provider.transcribe(effective_prompt(settings), payload))
    if not text:
        raise AiProviderError("empty_result")
    return text


def prepare_input(path: Path, mime: str) -> TranscriptionInput:
    """The bytes to send. Images are re-encoded, which drops EXIF/GPS and
    other metadata, honours the EXIF rotation and caps their size."""
    if mime == PDF_TYPE:
        if path.stat().st_size > MAX_SEND_BYTES:
            raise AiProviderError("file_too_large")
        return TranscriptionInput(path.read_bytes(), PDF_TYPE)

    from PIL import Image, ImageOps

    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened)
        image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        out = io.BytesIO()
        if image.mode in ("RGBA", "LA", "P"):
            image.convert("RGBA").save(out, format="PNG", optimize=True)
            result = TranscriptionInput(out.getvalue(), "image/png")
        else:
            image.convert("RGB").save(out, format="JPEG", quality=92)
            result = TranscriptionInput(out.getvalue(), "image/jpeg")
    if len(result.data) > MAX_SEND_BYTES:
        raise AiProviderError("file_too_large")
    return result


def _store_result(
    db: Session,
    tree: Workspace,
    file: DocumentFile,
    run: DocumentFileTranscription,
    markdown: str,
) -> None:
    text = db.get(DocumentFileText, file.id)
    previous = len(text.markdown.encode()) if text is not None else 0
    check_workspace_quota(db, tree, max(0, len(markdown.encode()) - previous))
    actor = db.get(User, run.requested_by)
    document = db.get(Document, file.document_id)
    now = utcnow_iso()
    with UnitOfWork(db) as uow:
        if text is None:
            text = DocumentFileText(
                document_file_id=file.id,
                workspace_id=tree.id,
                markdown=markdown,
                source="ai",
                created_at=now,
            )
            db.add(text)
        elif not text.markdown.strip() or text.markdown == text.machine_markdown:
            # Nobody changed the text since the last machine version.
            text.markdown = markdown
            text.source = "ai"
        text.machine_markdown = markdown
        text.provider = run.provider
        text.model = run.model
        text.status = "done"
        text.error = None
        text.updated_at = now
        run.status = "done"
        run.error = None
        run.updated_at = now
        if actor is not None and document is not None:
            record_activity(
                db,
                workspace_id=tree.id,
                actor=actor,
                action="update",
                target_type="document",
                target_id=document.id,
                target_label=document.title,
            )
            uow.after_commit(
                lambda: publish_workspace_event(
                    db, tree, "activity.entry_added", {"workspace_id": tree.id}
                )
            )
        uow.after_commit(lambda: _publish_changed(db, tree))


def _store_failure(
    db: Session, tree: Workspace, file: DocumentFile, file_id: str, error: str
) -> None:
    # allowlisted-rollback: drops whatever the failed attempt left half-done so
    # the failure itself can be recorded on a clean session.
    db.rollback()
    run = db.get(DocumentFileTranscription, file_id)
    if run is None:
        return
    with UnitOfWork(db) as uow:
        run.status = "failed"
        run.error = error[:500]
        run.updated_at = utcnow_iso()
        uow.after_commit(lambda: _publish_changed(db, tree))


def _publish_changed(db: Session, tree: Workspace) -> None:
    publish_workspace_event(
        db,
        tree,
        "workspace.content_changed",
        {"workspace_id": tree.id, "domain": "document"},
    )


def _notify(db: Session, user_id: str, workspace_id: str, file: DocumentFile) -> None:
    """Tell the person who asked that their run finished, either way."""
    try:
        run = db.get(DocumentFileTranscription, file.id)
        if run is None:
            return
        status, error = run_state(run)
        event_bus.publish(
            [user_id],
            "document.transcription_finished",
            {
                "workspace_id": workspace_id,
                "document_id": file.document_id,
                "file_id": file.id,
                "filename": file.filename,
                "status": status,
                "error": error,
            },
        )
    except Exception:
        logger.exception("Could not announce transcription of file %s", file.id)
