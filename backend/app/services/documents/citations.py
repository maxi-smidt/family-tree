"""Evidence for person fields: documents cited for a member's names, dates and
birthplace.

A :class:`MemberFieldCitation` points at a document, optionally one of its
files, a page and a quoted passage of that file's Markdown text. The quote is
kept as words, not as a position, so it survives edits and AI re-runs of the
text; :func:`quote_states` reports which quotes can no longer be found.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DocumentFileText, MemberFieldCitation

CITABLE_FIELDS: tuple[str, ...] = (
    "first_name",
    "middle_names",
    "last_name",
    "maiden_name",
    "baptismal_name",
    "date_of_birth",
    "date_of_death",
    "birthplace",
)

_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_TAG = re.compile(r"<[^>]+>")
_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_MARKERS = re.compile(r"[*_`~#>|\\]")
_SPACE = re.compile(r"\s+")


def plain_text(text: str) -> str:
    """Markdown reduced to the words a reader sees, for quote matching.

    The quote comes from a selection in the *rendered* text, so emphasis,
    headings, table pipes, links and page markers are dropped before
    comparing; case and runs of whitespace don't count either. The frontend's
    ``plainQuoteText`` applies the same rules.
    """
    text = _COMMENT.sub(" ", text)
    text = _LINK.sub(r"\1", text)
    text = _TAG.sub(" ", text)
    text = _MARKERS.sub(" ", text)
    return _SPACE.sub(" ", text).strip().casefold()


def quote_states(
    db: Session, citations: Iterable[MemberFieldCitation]
) -> dict[str, bool]:
    """For each quoted citation of a file with a text: is the quote still there?

    Citations without a quote, a file or a file text are left out (nothing to
    check). Each cited file's text is loaded once.
    """
    quoted = [c for c in citations if c.quote and c.document_file_id]
    if not quoted:
        return {}
    texts = dict(
        db.execute(
            select(DocumentFileText.document_file_id, DocumentFileText.markdown).where(
                DocumentFileText.document_file_id.in_(
                    {c.document_file_id for c in quoted}
                )
            )
        ).all()
    )
    plain = {file_id: plain_text(markdown) for file_id, markdown in texts.items()}
    states: dict[str, bool] = {}
    for citation in quoted:
        text = plain.get(citation.document_file_id)
        if text is None:
            continue
        needle = plain_text(citation.quote or "")
        states[citation.id] = bool(needle) and needle in text
    return states
