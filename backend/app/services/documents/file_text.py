"""Readable Markdown text for uploaded document files (#1121).

Each ``kind == "file"`` :class:`DocumentFile` may carry one
:class:`DocumentFileText`: its content as Markdown, in the file's original
language, written or corrected by hand.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DocumentFileText


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
