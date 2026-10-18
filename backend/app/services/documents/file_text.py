"""Readable Markdown text for uploaded document files (#1121).

Each ``kind == "file"`` :class:`DocumentFile` may carry one
:class:`DocumentFileText`: its content as Markdown, in the file's original
language. People write or correct it by hand; born-digital PDFs get it from
their own text layer as soon as they are attached, with no OCR involved.

Multi-page text marks each page with an HTML comment (``<!-- page 3 -->``):
the Markdown renderer hides it, and a reader can still line text up with the
page it came from.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from pathlib import Path

from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.base import utcnow_iso
from app.db.session import SessionLocal
from app.models import DocumentFile, DocumentFileText, Workspace
from app.services.event_bus import publish_workspace_event
from app.services.media.storage import media_url_to_path
from app.services.unit_of_work import UnitOfWork

logger = logging.getLogger("app.document_file_text")

# Upper bound on one file's text. Far beyond any transcription a person would
# write, but it keeps a pathological PDF from producing a multi-megabyte row.
MAX_TEXT_CHARS = 1_000_000
# Stop reading a PDF's text layer after this many pages.
MAX_PDF_PAGES = 2_000

PDF_MIME = "application/pdf"


def page_marker(page_number: int) -> str:
    return f"<!-- page {page_number} -->"


def files_with_text(db: Session, file_ids: Iterable[str]) -> set[str]:
    """The subset of *file_ids* that have a text row, in one query."""
    ids = list(file_ids)
    if not ids:
        return set()
    return set(
        db.scalars(
            select(DocumentFileText.document_file_id).where(
                DocumentFileText.document_file_id.in_(ids)
            )
        )
    )


def pdf_text_markdown(path: Path) -> str | None:
    """The PDF's embedded text as Markdown, or ``None`` when it has none.

    Scanned PDFs without a text layer return ``None`` (they need OCR, which
    is a later step). Never raises: a damaged or encrypted PDF simply has no
    text to offer.
    """
    try:
        reader = PdfReader(path)
        if reader.is_encrypted and not reader.decrypt(""):
            return None
        pages: list[str] = []
        total = 0
        for page in reader.pages[:MAX_PDF_PAGES]:
            text = (page.extract_text() or "").strip()
            pages.append(text)
            total += len(text)
            if total > MAX_TEXT_CHARS:
                break
    except Exception:
        logger.warning("Could not read the text layer of %s", path.name, exc_info=True)
        return None

    if not any(pages):
        return None
    if len(pages) == 1:
        markdown = pages[0]
    else:
        markdown = "\n\n".join(
            f"{page_marker(number)}\n\n{text}" if text else page_marker(number)
            for number, text in enumerate(pages, start=1)
        )
    return markdown[:MAX_TEXT_CHARS]


def extract_pdf_texts(workspace_id: str, file_ids: list[str]) -> None:
    """Fill in text for newly attached PDFs from their own text layer.

    Runs as a background task after the attaching request committed, so a
    large PDF never slows down the save. Skips files that already have text
    (someone may have typed it in the meantime) and files that are not PDFs.
    Owns its session and never raises.
    """
    db = SessionLocal()
    try:
        added = False
        for file_id in file_ids:
            file = db.get(DocumentFile, file_id)
            if (
                file is None
                or file.workspace_id != workspace_id
                or file.kind != "file"
                or file.mime_type != PDF_MIME
            ):
                continue
            if db.get(DocumentFileText, file_id) is not None:
                continue
            path = media_url_to_path(file.url, expected_tree_id=workspace_id)
            if path is None:
                continue
            markdown = pdf_text_markdown(path)
            if markdown is None:
                continue
            now = utcnow_iso()
            try:
                with UnitOfWork(db):
                    db.add(
                        DocumentFileText(
                            document_file_id=file_id,
                            workspace_id=workspace_id,
                            markdown=markdown,
                            machine_markdown=markdown,
                            source="pdf_text",
                            created_at=now,
                            updated_at=now,
                        )
                    )
            except IntegrityError:
                # Someone saved text by hand while the PDF was read (theirs
                # wins), or the file was removed in the meantime.
                continue
            added = True
        if added:
            tree = db.get(Workspace, workspace_id)
            if tree is not None:
                publish_workspace_event(
                    db,
                    tree,
                    "workspace.content_changed",
                    {"workspace_id": workspace_id, "domain": "document"},
                )
    except Exception:
        logger.exception("PDF text extraction failed for workspace %s", workspace_id)
    finally:
        db.close()
