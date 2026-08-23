"""Validation and planning for ``save_document``.

Resolves a save request into a typed :class:`DocumentSavePlan` — nothing is
mutated here, so the decision of *what* to change is testable without a
commit. See ``document_service`` for how the plan is applied.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.core.exceptions import InvalidInputError
from app.models import DocumentFile, DocumentUpload, Workspace
from app.schemas.content import DocumentSave
from app.services.media.storage_usage import check_workspace_quota


def external_link_url(raw_url: str) -> str:
    """Validate and normalise an external ``http(s)`` link URL.

    Rejects anything with embedded whitespace/control characters, credentials,
    a non-web scheme, or no host, so a stored link can never smuggle a
    ``javascript:``/``data:`` payload or an internal media reference.
    """
    url = raw_url.strip()
    if not url or "\\" in url or any(char.isspace() or ord(char) == 127 for char in url):
        raise InvalidInputError("Invalid link URL")
    try:
        parsed = urlsplit(url)
        # Accessing port performs urllib's range and syntax validation.
        _ = parsed.port
    except ValueError as exc:
        raise InvalidInputError("Invalid link URL") from exc
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise InvalidInputError("Invalid link URL")
    return url


def _document_file_on(db: Session, document_id: str, file_id: str) -> DocumentFile | None:
    """Return the file iff it exists and belongs to *document_id*, else None."""
    row = db.get(DocumentFile, file_id)
    if row is None or row.document_id != document_id:
        return None
    return row


def _estimated_document_bytes(payload: DocumentSave) -> int:
    parts = [payload.title, payload.description or "", payload.document_date or ""]
    return len("".join(parts).encode())


@dataclass(frozen=True)
class NewLink:
    id: str
    url: str
    filename: str | None


@dataclass(frozen=True)
class Rename:
    row: DocumentFile
    filename: str


@dataclass(frozen=True)
class DocumentSavePlan:
    """Everything ``save_document`` needs to mutate, already resolved and
    validated. Ids already applied by a prior attempt resolve to a no-op
    here, which is what makes replaying a save request idempotent.
    """

    is_create: bool
    new_links: list[NewLink]
    attachments: list[DocumentUpload]
    removed_rows: list[DocumentFile]
    renames: list[Rename]
    delete_urls: list[str]


def build_save_plan(
    db: Session,
    *,
    tree: Workspace,
    document_id: str,
    is_create: bool,
    payload: DocumentSave,
) -> DocumentSavePlan:
    """Validate *payload* and resolve it into a :class:`DocumentSavePlan`,
    without mutating anything. Raises ``InvalidInputError`` or
    ``QuotaExceeded`` on an invalid link or an over-quota create.
    """
    # Validate external links up-front. Skip ids already present so a retry
    # neither re-validates nor re-inserts them.
    new_links = [
        NewLink(link.id, external_link_url(link.url), link.filename)
        for link in payload.added_links
        if _document_file_on(db, document_id, link.id) is None
    ]

    # Resolve staged uploads to attach. Skip ids already attached (retry) and
    # ids that no longer exist or belong to another tree (consumed on a prior
    # attempt, or never ours) — both make the attach idempotent.
    attachments: list[DocumentUpload] = []
    seen_uploads: set[str] = set()
    for upload_id in payload.attached_upload_ids:
        if upload_id in seen_uploads:
            continue
        seen_uploads.add(upload_id)
        if _document_file_on(db, document_id, upload_id) is not None:
            continue
        upload = db.get(DocumentUpload, upload_id)
        if upload is None or upload.workspace_id != tree.id:
            continue
        attachments.append(upload)

    # Resolve removed files that actually exist (idempotent no-op otherwise).
    removed_rows: list[DocumentFile] = []
    removed_ids: set[str] = set()
    for fid in payload.removed_file_ids:
        if fid in removed_ids:
            continue
        removed_ids.add(fid)
        row = _document_file_on(db, document_id, fid)
        if row is not None:
            removed_rows.append(row)

    renames: list[Rename] = []
    for rename in payload.renamed_files:
        if rename.id in removed_ids:
            continue  # a file being removed can't also be renamed
        row = _document_file_on(db, document_id, rename.id)
        if row is not None:
            renames.append(Rename(row, rename.filename))

    # A create adds a metadata row; the attached bytes were already
    # quota-checked when they were staged, so no media check is needed here.
    # check_workspace_quota raises QuotaExceeded, mapped to its HTTP response by
    # the centralized handler.
    if is_create:
        check_workspace_quota(db, tree, _estimated_document_bytes(payload))

    delete_urls = [row.url for row in removed_rows if row.kind == "file"]

    return DocumentSavePlan(
        is_create=is_create,
        new_links=new_links,
        attachments=attachments,
        removed_rows=removed_rows,
        renames=renames,
        delete_urls=delete_urls,
    )
