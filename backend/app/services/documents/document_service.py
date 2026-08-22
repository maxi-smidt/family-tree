"""Transactional composite save for documents.

A document edit touches three stores that cannot share one transaction: the
metadata/link rows, the file rows, and the bytes on disk. Files are uploaded to
a staging area first (streamed, memory-bounded — see ``store_document_upload``),
which writes the bytes to their final media location and records a
:class:`DocumentUpload` row. The composite save then applies everything as one
unit with explicit ordering, so a failure can never destroy the previously
valid document or leak files:

  1. Validate everything (links, ownership, quota) with nothing mutated, and
     resolve it into a typed :class:`~app.services.documents.document_save_plan.
     DocumentSavePlan` (see that module).
  2. In one transaction: upsert the document, replace member links, attach the
     staged uploads (turning each into a ``DocumentFile`` and consuming its
     ``DocumentUpload`` row), remove/rename files, and record the activity.
  3. Only after the commit succeeds delete the now-unreferenced old bytes; if
     the commit fails, the transaction rolls back — the staged uploads stay on
     disk (referenced by their ``DocumentUpload`` rows) for a retry or the
     reaper, and the old files are untouched.

Every change is keyed by a client-supplied id, so replaying the same request is
a no-op — retries are idempotent.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.base import utcnow_iso
from app.models import Document, DocumentFile, DocumentMemberLink, DocumentUpload, Tree
from app.models.user import User
from app.schemas.content import DocumentSave
from app.services.activity.activity import record_activity
from app.services.documents.content_links import replace_member_links
from app.services.documents.document_save_plan import (
    DocumentSavePlan,
    build_save_plan,
    external_link_url,
)
from app.services.event_bus import publish_tree_event
from app.services.media.storage import delete_media
from app.services.unit_of_work import UnitOfWork

__all__ = ["external_link_url", "prune_stale_uploads", "save_document"]

# How long a staged upload may sit unclaimed before it is eligible for reaping.
# Generous enough to cover a slow multi-file upload session, short enough that
# an abandoned dialog does not tie up quota for long.
STALE_UPLOAD_TTL_SECONDS = 6 * 60 * 60


def prune_stale_uploads(db: Session, tree: Tree) -> None:
    """Delete this tree's staged uploads that were never claimed within the TTL.

    Called opportunistically when a new upload is staged, so abandoned uploads
    (their bytes already counted against quota) are reclaimed the next time the
    tree is touched instead of lingering. Best-effort and self-contained: it
    commits its own cleanup and never raises into the caller's flow.
    """
    cutoff = (
        datetime.now(UTC) - timedelta(seconds=STALE_UPLOAD_TTL_SECONDS)
    ).isoformat()
    stale = db.scalars(
        select(DocumentUpload).where(
            DocumentUpload.tree_id == tree.id,
            DocumentUpload.created_at < cutoff,
        )
    ).all()
    if not stale:
        return
    urls = [row.url for row in stale]
    try:
        with UnitOfWork(db) as uow:
            for row in stale:
                db.delete(row)
            uow.after_commit(lambda: [delete_media(url) for url in urls])
    except Exception:
        return


def _persist_save_plan(
    db: Session,
    *,
    tree: Tree,
    user: User,
    document_id: str,
    existing: Document | None,
    plan: DocumentSavePlan,
    payload: DocumentSave,
    now: str,
) -> Document:
    """Apply *plan* as one ``UnitOfWork`` — upsert the document, replace member
    links, attach/remove/rename files, and record the activity — then, only
    once that commits, delete the now-unreferenced old bytes and publish.

    The old bytes are removed *after* the rows that replaced them are durable,
    so a crash mid-way leaves at worst some unreferenced bytes rather than a
    live row pointing at a missing file. A commit failure rolls the whole edit
    back — the staged uploads (still referenced by their ``DocumentUpload``
    rows) and the previous files both survive.
    """
    with UnitOfWork(db) as uow:
        if plan.is_create:
            document = Document(
                id=document_id,
                tree_id=tree.id,
                title=payload.title,
                description=payload.description,
                document_date=payload.document_date,
                created_at=now,
                updated_at=now,
            )
            db.add(document)
            db.flush()  # document row must exist before its links/files reference it
        else:
            document = existing
            document.title = payload.title
            document.description = payload.description
            document.document_date = payload.document_date
            document.updated_at = now

        replace_member_links(
            db,
            link_model=DocumentMemberLink,
            parent_fk=DocumentMemberLink.document_id,
            parent_id=document_id,
            tree=tree,
            member_ids=payload.member_ids,
        )

        for row in plan.removed_rows:
            db.delete(row)

        for rename in plan.renames:
            rename.row.filename = rename.filename

        for link in plan.new_links:
            db.add(
                DocumentFile(
                    id=link.id,
                    tree_id=tree.id,
                    document_id=document_id,
                    kind="link",
                    filename=link.filename,
                    url=link.url,
                    mime_type=None,
                    size=None,
                    created_at=now,
                )
            )

        # Attach staged uploads: promote each to a committed file row (reusing
        # the upload's id so a replay is a no-op) and consume its staging row
        # so the bytes are now owned by the document, not the staging area.
        for upload in plan.attachments:
            db.add(
                DocumentFile(
                    id=upload.id,
                    tree_id=tree.id,
                    document_id=document_id,
                    kind="file",
                    filename=upload.filename,
                    url=upload.url,
                    mime_type=upload.mime_type,
                    size=upload.size,
                    created_at=now,
                )
            )
            db.delete(upload)

        record_activity(
            db,
            tree_id=tree.id,
            actor=user,
            action="create" if plan.is_create else "update",
            target_type="document",
            target_id=document_id,
            target_label=payload.title,
        )

        delete_urls = plan.delete_urls
        uow.after_commit(lambda: [delete_media(url) for url in delete_urls])
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
                {"tree_id": tree.id, "domain": "document"},
            )
        )
    return document


def save_document(
    db: Session,
    *,
    tree: Tree,
    user: User,
    document_id: str,
    payload: DocumentSave,
) -> Document:
    """Create or update a document and apply every file change in one unit.

    ``document_id`` is client-supplied and used as the upsert key, so a create
    that is retried updates in place instead of duplicating. Raises
    ``InvalidInputError``, ``NotFoundError``, or ``QuotaExceeded`` on
    validation, ownership, or quota errors — always *before* any rows are
    mutated.
    """
    existing = db.get(Document, document_id)
    if existing is not None and existing.tree_id != tree.id:
        raise NotFoundError("Document not found")
    is_create = existing is None

    plan = build_save_plan(
        db, tree=tree, document_id=document_id, is_create=is_create, payload=payload
    )

    document = _persist_save_plan(
        db,
        tree=tree,
        user=user,
        document_id=document_id,
        existing=existing,
        plan=plan,
        payload=payload,
        now=utcnow_iso(),
    )
    db.refresh(document)
    return document
