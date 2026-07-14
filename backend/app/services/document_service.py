"""Transactional composite save for documents.

A document edit touches three stores that cannot share one transaction: the
metadata/link rows, the file rows, and the bytes on disk. Files are uploaded to
a staging area first (streamed, memory-bounded — see ``store_document_upload``),
which writes the bytes to their final media location and records a
:class:`DocumentUpload` row. The composite save then applies everything as one
unit with explicit ordering, so a failure can never destroy the previously
valid document or leak files:

  1. Validate everything (links, ownership) with nothing mutated.
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
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.models import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    DocumentUpload,
    Tree,
)
from app.models.user import User
from app.schemas.content import DocumentSave
from app.services.activity import record_activity
from app.services.content_links import replace_member_links
from app.services.event_bus import publish_tree_event
from app.services.storage import delete_media
from app.services.storage_usage import QuotaExceeded, check_tree_quota

# How long a staged upload may sit unclaimed before it is eligible for reaping.
# Generous enough to cover a slow multi-file upload session, short enough that
# an abandoned dialog does not tie up quota for long.
STALE_UPLOAD_TTL_SECONDS = 6 * 60 * 60


def external_link_url(raw_url: str) -> str:
    """Validate and normalise an external ``http(s)`` link URL.

    Rejects anything with embedded whitespace/control characters, credentials,
    a non-web scheme, or no host, so a stored link can never smuggle a
    ``javascript:``/``data:`` payload or an internal media reference.
    """
    url = raw_url.strip()
    if not url or "\\" in url or any(
        char.isspace() or ord(char) == 127 for char in url
    ):
        raise HTTPException(status_code=400, detail="Invalid link URL")
    try:
        parsed = urlsplit(url)
        # Accessing port performs urllib's range and syntax validation.
        _ = parsed.port
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid link URL") from exc
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise HTTPException(status_code=400, detail="Invalid link URL")
    return url


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
    for row in stale:
        db.delete(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        return
    for url in urls:
        delete_media(url)


def _run_commit(db: Session) -> None:
    """Commit seam — overridden by failure-injection tests to simulate a
    DB commit failure at exactly this boundary."""
    db.commit()


def _commit_with_deletes(db: Session, delete_urls: list[str]) -> None:
    """Commit the DB, then delete the now-unreferenced old files.

    The old bytes are removed *after* the rows that replaced them are durable,
    so a crash mid-way leaves at worst some unreferenced bytes rather than a
    live row pointing at a missing file. A commit failure rolls the whole edit
    back — the staged uploads (still referenced by their ``DocumentUpload``
    rows) and the previous files both survive — and re-raises.
    """
    try:
        _run_commit(db)
    except Exception:
        db.rollback()
        raise
    for url in delete_urls:
        delete_media(url)


def _document_file_on(
    db: Session, document_id: str, file_id: str
) -> DocumentFile | None:
    """Return the file iff it exists and belongs to *document_id*, else None."""
    row = db.get(DocumentFile, file_id)
    if row is None or row.document_id != document_id:
        return None
    return row


def _estimated_document_bytes(payload: DocumentSave) -> int:
    parts = [payload.title, payload.description or "", payload.document_date or ""]
    return len("".join(parts).encode())


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
    ``HTTPException`` (400/404/413) on validation, ownership, or quota errors —
    always *before* any rows are mutated.
    """
    existing = db.get(Document, document_id)
    if existing is not None and existing.tree_id != tree.id:
        raise HTTPException(status_code=404, detail="Document not found")
    is_create = existing is None

    # 1a. Validate external links up-front. Skip ids already present so a retry
    #     neither re-validates nor re-inserts them.
    new_links: list[tuple[str, str, str | None]] = []
    for link in payload.added_links:
        if _document_file_on(db, document_id, link.id) is not None:
            continue
        new_links.append((link.id, external_link_url(link.url), link.filename))

    # 1b. Resolve staged uploads to attach. Skip ids already attached (retry)
    #     and ids that no longer exist or belong to another tree (consumed on a
    #     prior attempt, or never ours) — both make the attach idempotent.
    attachments: list[DocumentUpload] = []
    seen_uploads: set[str] = set()
    for upload_id in payload.attached_upload_ids:
        if upload_id in seen_uploads:
            continue
        seen_uploads.add(upload_id)
        if _document_file_on(db, document_id, upload_id) is not None:
            continue
        upload = db.get(DocumentUpload, upload_id)
        if upload is None or upload.tree_id != tree.id:
            continue
        attachments.append(upload)

    # 1c. Resolve removed files that actually exist (idempotent no-op otherwise).
    removed_rows: list[DocumentFile] = []
    removed_ids: set[str] = set()
    for fid in payload.removed_file_ids:
        if fid in removed_ids:
            continue
        removed_ids.add(fid)
        row = _document_file_on(db, document_id, fid)
        if row is not None:
            removed_rows.append(row)

    # 1d. A create adds a metadata row; the attached bytes were already
    #     quota-checked when they were staged, so no media check is needed here.
    if is_create:
        try:
            check_tree_quota(db, tree, _estimated_document_bytes(payload))
        except QuotaExceeded as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc

    now = utcnow_iso()
    delete_urls: list[str] = []

    # 2. Apply all DB rows in one transaction.
    if is_create:
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

    for row in removed_rows:
        if row.kind == "file":
            delete_urls.append(row.url)
        db.delete(row)

    for rename in payload.renamed_files:
        if rename.id in removed_ids:
            continue  # a file being removed can't also be renamed
        row = _document_file_on(db, document_id, rename.id)
        if row is not None:
            row.filename = rename.filename

    for lid, url, filename in new_links:
        db.add(
            DocumentFile(
                id=lid,
                tree_id=tree.id,
                document_id=document_id,
                kind="link",
                filename=filename,
                url=url,
                mime_type=None,
                size=None,
                created_at=now,
            )
        )

    # Attach staged uploads: promote each to a committed file row (reusing the
    # upload's id so a replay is a no-op) and consume its staging row so the
    # bytes are now owned by the document, not the staging area.
    for upload in attachments:
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
        action="create" if is_create else "update",
        target_type="document",
        target_id=document_id,
        target_label=payload.title,
    )

    # 3. Commit, then delete the now-unreferenced old files (or roll back).
    _commit_with_deletes(db, delete_urls)

    publish_tree_event(db, tree, "activity.entry_added", {"tree_id": tree.id})
    db.refresh(document)
    publish_tree_event(
        db,
        tree,
        "tree.content_changed",
        {"tree_id": tree.id, "domain": "document"},
    )
    return document
