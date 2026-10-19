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

# Emphasis, heading, quote and escape marks render as nothing, so removing
# them keeps "**Johann**, Sohn" as "johann, sohn". Table pipes separate cells.
_MARKERS = re.compile(r"[*_`~#>\\]")
_CELL = re.compile(r"\|")
_SPACE = re.compile(r"\s+")


def _drop_comments(text: str) -> str:
    """Replace each ``<!-- … -->`` with a space. A plain scan rather than a regex:
    file texts are long and user-written, and a lazy regex over many
    unclosed marks takes quadratic time; so do the scans below."""
    parts: list[str] = []
    position = 0
    while True:
        open_at = text.find("<!--", position)
        if open_at == -1:
            break
        close_at = text.find("-->", open_at + 4)
        if close_at == -1:
            # No later comment can close either.
            break
        parts.append(text[position:open_at])
        parts.append(" ")
        position = close_at + 3
    parts.append(text[position:])
    return "".join(parts)


def _drop_tags(text: str) -> str:
    """``<…>`` with at least one character inside becomes a space."""
    parts: list[str] = []
    position = 0
    search = 0
    while True:
        open_at = text.find("<", search)
        if open_at == -1:
            break
        close_at = text.find(">", open_at + 1)
        if close_at == -1:
            break
        if close_at == open_at + 1:
            # "<>" is no tag; keep it and look past it.
            search = close_at + 1
            continue
        parts.append(text[position:open_at])
        parts.append(" ")
        position = search = close_at + 1
    parts.append(text[position:])
    return "".join(parts)


def _unwrap_links(text: str) -> str:
    """``[label](url)`` and ``![alt](src)`` become their label."""
    parts: list[str] = []
    position = 0
    search = 0
    while True:
        open_at = text.find("[", search)
        if open_at == -1:
            break
        label_end = text.find("]", open_at + 1)
        if label_end == -1:
            break
        if not text.startswith("(", label_end + 1):
            # Every "[" up to this "]" closes here too: none is a link.
            search = label_end + 1
            continue
        url_end = text.find(")", label_end + 2)
        if url_end == -1:
            break
        start = open_at
        if open_at > position and text[open_at - 1] == "!":
            start -= 1
        parts.append(text[position:start])
        parts.append(text[open_at + 1 : label_end])
        position = search = url_end + 1
    parts.append(text[position:])
    return "".join(parts)


def plain_text(text: str) -> str:
    """Markdown reduced to the words a reader sees, for quote matching.

    The quote comes from a selection in the *rendered* text, so emphasis,
    headings, table pipes, links and page markers are dropped before
    comparing; case and runs of whitespace don't count either. The frontend's
    ``plainQuoteText`` applies the same rules.
    """
    text = _drop_comments(text)
    text = _unwrap_links(text)
    text = _drop_tags(text)
    text = _MARKERS.sub("", text)
    text = _CELL.sub(" ", text)
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
