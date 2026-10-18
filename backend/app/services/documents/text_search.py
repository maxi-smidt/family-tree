"""Search documents by title, description and file text (#1122).

File texts can run to many pages, so the matching is deliberately strict to
keep false positives from piling up:

* Every query word must match (AND), as the start of a word in the text:
  ``tauf`` finds "Taufbuch", but ``uch`` does not. Words of two letters must
  match a whole word; single letters are ignored.
* With several words, a text or description only matches where *all* of them
  sit close together (within :data:`PROXIMITY_WINDOW` words), never scattered
  across a long transcript. Quoting (``"Johann Weber"``) asks for the words
  side by side, in order.
* A document contributes at most :data:`MAX_FILES_PER_DOCUMENT` file hits, so
  one long register cannot fill the result list.
* Similar spellings (trigram similarity, for old spellings and transcription
  slips) are only tried when the exact search finds nothing, only for words
  of four letters or more, and come back flagged as ``fuzzy``.

Matching folds case, umlauts (``ä`` = ``ae``) and accents the same way on
both sides. On Postgres a generated, GIN-indexed ``tsvector`` (and a trigram
index for the fallback) narrows the candidates;
the final decision, the ranking and the snippet are always computed here in
Python, so every database gives the same answer.
"""

from __future__ import annotations

import functools
import math
import re
from dataclasses import dataclass, field

from sqlalchemy import String, func, literal, literal_column, select
from sqlalchemy.orm import Session

from app.models import ContentType, Document, DocumentFile, DocumentFileText
from app.services.documents.document_service import DOMAIN
from app.services.workspaces.visibility import WorkspaceAccessContext

# --- Folding ----------------------------------------------------------------

#: Multi-letter replacements applied after lower-casing. Kept identical to the
#: ``ft_fold`` SQL function created by the ``v2_2_0_document_text_search``
#: migration (a test compares the two).
FOLD_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("ä", "ae"),
    ("ö", "oe"),
    ("ü", "ue"),
    ("ß", "ss"),
    ("æ", "ae"),
    ("œ", "oe"),
)
#: One-to-one accent removal, applied after :data:`FOLD_REPLACEMENTS`.
FOLD_FROM = "àáâãåāăąèéêëēĕėęěìíîïĩīĭįòóôõøōŏőùúûũūŭůűųýÿçćĉċčñńňśšźżžďđťłľĺŕř"
FOLD_TO = "aaaaaaaaeeeeeeeeeiiiiiiiioooooooouuuuuuuuuyycccccnnnsszzzddtlllrr"
_FOLD_TABLE = str.maketrans(FOLD_FROM, FOLD_TO)

_WORD = re.compile(r"[^\W_]+")


def fold(value: str) -> str:
    """Lower-case and strip umlauts/accents, as ``ft_fold`` does in SQL."""
    folded = value.lower()
    for source, target in FOLD_REPLACEMENTS:
        folded = folded.replace(source, target)
    return folded.translate(_FOLD_TABLE)


# --- Query parsing ----------------------------------------------------------

MIN_PREFIX_LENGTH = 3
MIN_FUZZY_LENGTH = 4
FUZZY_THRESHOLD = 0.5
PROXIMITY_WINDOW = 15
MAX_TERMS = 8
MAX_FILES_PER_DOCUMENT = 3
#: Texts loaded per query for the final check. Postgres orders them by cover
#: density first, so the best candidates are the ones checked.
CANDIDATE_LIMIT = 40
#: Characters of text checked per query at most; past it the rest of the
#: candidates are skipped and the result is marked truncated.
CHECK_BUDGET_CHARS = 4_000_000

_QUOTED = re.compile(r'"([^"]*)"?')


@dataclass(frozen=True)
class Term:
    """One AND-ed part of a query: a single word, or a quoted phrase."""

    tokens: tuple[str, ...]


@dataclass(frozen=True)
class ParsedQuery:
    terms: tuple[Term, ...]

    @property
    def tokens(self) -> list[str]:
        return [token for term in self.terms for token in term.tokens]


def _usable_tokens(chunk: str) -> list[str]:
    return [t for t in _WORD.findall(fold(chunk)) if len(t) >= 2]


def parse_query(q: str) -> ParsedQuery:
    """Split ``q`` into terms; quoted parts become phrases (an unclosed quote
    still counts, so a phrase being typed already narrows the results)."""
    terms: list[Term] = []
    rest_parts: list[str] = []
    position = 0
    for match in _QUOTED.finditer(q):
        rest_parts.append(q[position : match.start()])
        position = match.end()
        tokens = _usable_tokens(match.group(1))
        if tokens:
            terms.append(Term(tuple(tokens)))
    rest_parts.append(q[position:])
    seen = {term.tokens for term in terms}
    for token in _usable_tokens(" ".join(rest_parts)):
        if (token,) not in seen:
            seen.add((token,))
            terms.append(Term((token,)))
    return ParsedQuery(tuple(terms[:MAX_TERMS]))


# --- Plain text from Markdown -----------------------------------------------

_PAGE_MARKER = re.compile(r"<!--\s*page\s+(\d+)\s*-->", re.IGNORECASE)
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_TAG = re.compile(r"</?[A-Za-z][^>]*>")
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_TABLE_RULE = re.compile(r"^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$", re.MULTILINE)
_BLOCK_PREFIX = re.compile(r"^\s{0,3}(?:#{1,6}|>+|[-*+]|\d+[.)])\s+", re.MULTILINE)
_RULE = re.compile(r"^\s{0,3}(?:[-*_]\s*){3,}$", re.MULTILINE)
_ESCAPE = re.compile(r"\\([\\`*_{}\[\]()#+\-.!|>~])")
_INLINE_MARKS = re.compile(r"[*_~`|]")
_SPACE = re.compile(r"\s+")


def _strip_markdown(value: str) -> str:
    value = _COMMENT.sub(" ", value)
    value = _TAG.sub(" ", value)
    value = _IMAGE.sub(r"\1", value)
    value = _LINK.sub(r"\1", value)
    value = _TABLE_RULE.sub(" ", value)
    value = _RULE.sub(" ", value)
    value = _BLOCK_PREFIX.sub("", value)
    value = _ESCAPE.sub(lambda m: "\0" + m.group(1), value)
    value = _INLINE_MARKS.sub(" ", value)
    value = value.replace("\0", "")
    return _SPACE.sub(" ", value).strip()


@dataclass(frozen=True)
class PlainText:
    """Markdown flattened to one line of readable text, with the offset at
    which each ``<!-- page N -->`` marker's page starts."""

    text: str
    pages: tuple[tuple[int, int], ...] = ()  # (offset, page number)

    def page_at(self, offset: int) -> int | None:
        page = None
        for start, number in self.pages:
            if start > offset:
                break
            page = number
        return page


def plain_text(markdown: str) -> PlainText:
    pieces = _PAGE_MARKER.split(markdown)
    # split() alternates text, page number, text, ...
    parts: list[str] = []
    pages: list[tuple[int, int]] = []
    length = 0
    for index, piece in enumerate(pieces):
        if index % 2 == 1:
            pages.append((length + (1 if parts else 0), int(piece)))
            continue
        stripped = _strip_markdown(piece)
        if not stripped:
            continue
        if parts:
            length += 1
        parts.append(stripped)
        length += len(stripped)
    return PlainText(" ".join(parts), tuple(pages))


# --- Matching ---------------------------------------------------------------


class Words:
    """The words of a plain text: folded form plus the original span, and an
    index from each distinct folded word to where it occurs, so a query word
    is compared once per distinct word rather than once per occurrence."""

    def __init__(self, value: str) -> None:
        self.folded: list[str] = []
        self.starts: list[int] = []
        self.ends: list[int] = []
        for match in _WORD.finditer(value):
            word = match.group()
            folded = word.lower() if word.isascii() else fold(word)
            # Folding keeps a word in one piece in practice; if an exotic
            # letter ever splits it, every piece keeps the original span.
            for part in [folded] if folded.isalnum() else _WORD.findall(folded):
                self.folded.append(part)
                self.starts.append(match.start())
                self.ends.append(match.end())
        self._positions: dict[str, list[int]] | None = None

    def __len__(self) -> int:
        return len(self.folded)

    def positions(self) -> dict[str, list[int]]:
        if self._positions is None:
            self._positions = {}
            for index, word in enumerate(self.folded):
                self._positions.setdefault(word, []).append(index)
        return self._positions


def words_of(value: str) -> Words:
    return Words(value)


def _trigrams(word: str) -> set[str]:
    padded = f"  {word} "
    return {padded[i : i + 3] for i in range(len(padded) - 2)}


@functools.lru_cache(maxsize=64)
def _query_trigrams(token: str) -> frozenset[str]:
    return frozenset(_trigrams(token))


def trigram_similarity(a: str, b: str) -> float:
    """pg_trgm's ``similarity()`` for two single words."""
    ta = _query_trigrams(a)
    # A word has at most len + 2 trigrams, and the similarity can't exceed
    # the smaller set over the larger: skip words too short to qualify.
    if len(b) + 2 < FUZZY_THRESHOLD * len(ta):
        return 0.0
    tb = _trigrams(b)
    union = ta | tb
    return len(ta & tb) / len(union) if union else 0.0


def token_matches(token: str, word: str, *, fuzzy: bool, prefix: bool = True) -> bool:
    if len(token) < MIN_PREFIX_LENGTH or not prefix:
        if word == token:
            return True
    elif word.startswith(token):
        return True
    return (
        fuzzy
        and len(token) >= MIN_FUZZY_LENGTH
        and trigram_similarity(token, word) >= FUZZY_THRESHOLD
    )


@dataclass(frozen=True)
class Occurrence:
    first: int  # word index
    last: int


def _term_occurrences(term: Term, words: Words, *, fuzzy: bool) -> list[Occurrence]:
    size = len(term.tokens)
    positions = words.positions()
    first, *rest = term.tokens
    starts: list[int] = []
    for word, indexes in positions.items():
        if token_matches(first, word, fuzzy=fuzzy, prefix=size == 1):
            starts.extend(indexes)
    found = []
    for i in sorted(starts):
        if i + size > len(words):
            continue
        if all(
            token_matches(
                token,
                words.folded[i + k],
                fuzzy=fuzzy,
                # Inside a phrase only the last word may be unfinished.
                prefix=k == size - 1,
            )
            for k, token in enumerate(rest, start=1)
        ):
            found.append(Occurrence(i, i + size - 1))
    return found


@dataclass
class FieldMatch:
    count: int
    #: Word indexes of the best (tightest) match.
    first: int
    last: int
    matched: set[int]
    adjacent: bool
    whole_words: bool
    span: int


def match_field(
    query: ParsedQuery,
    words: Words,
    *,
    fuzzy: bool,
    window: int | None,
) -> FieldMatch | None:
    """Where ``query`` matches ``words``: every term, and with more than one
    term all within ``window`` words of each other (``None``: anywhere)."""
    if not query.terms or not len(words):
        return None
    per_term = [_term_occurrences(term, words, fuzzy=fuzzy) for term in query.terms]
    if any(not occurrences for occurrences in per_term):
        return None

    events = sorted(
        (occ.first, occ.last, term_index)
        for term_index, occurrences in enumerate(per_term)
        for occ in occurrences
    )
    windows: list[list[tuple[int, int, int]]] = []
    if len(query.terms) == 1:
        windows = [[event] for event in events]
    else:
        # Greedy left-to-right scan: each time the events since the last
        # window cover every term within ``window`` words, record the
        # tightest such group and start over after it, so the count is of
        # separate passages, not of overlapping combinations.
        active: list[tuple[int, int, int]] = []
        for event in events:
            active.append(event)
            limit = window if window is not None else math.inf
            active = [e for e in active if event[1] - e[0] < limit]
            latest: dict[int, tuple[int, int, int]] = {}
            for e in active:
                latest[e[2]] = e
            if len(latest) == len(query.terms):
                windows.append(sorted(latest.values()))
                active = []
    if not windows:
        return None

    def span(group: list[tuple[int, int, int]]) -> int:
        return max(e[1] for e in group) - min(e[0] for e in group) + 1

    best = min(windows, key=lambda group: (span(group), group[0][0]))
    matched = {i for e in best for i in range(e[0], e[1] + 1)}
    in_order = [e[2] for e in best] == sorted(e[2] for e in best)
    adjacent = len(query.tokens) > 1 and in_order and span(best) == len(query.tokens)
    whole = all(
        words.folded[i] in query.tokens for e in best for i in range(e[0], e[1] + 1)
    )
    return FieldMatch(
        count=len(windows),
        first=min(e[0] for e in best),
        last=max(e[1] for e in best),
        matched=matched,
        adjacent=adjacent,
        whole_words=whole,
        span=span(best),
    )


# --- Snippets ---------------------------------------------------------------

SNIPPET_BEFORE = 60
SNIPPET_AFTER = 120


@dataclass(frozen=True)
class Snippet:
    text: str
    highlights: tuple[tuple[int, int], ...]


def build_snippet(value: str, words: Words, match: FieldMatch) -> Snippet:
    start = words.starts[match.first]
    end = words.ends[match.last]
    lo = max(0, start - SNIPPET_BEFORE)
    hi = min(len(value), max(end, start + SNIPPET_AFTER))
    # Cut on spaces, not inside words.
    if lo > 0:
        space = value.find(" ", lo, start)
        lo = space + 1 if space != -1 else lo
    if hi < len(value):
        space = value.rfind(" ", end, hi)
        hi = space if space != -1 else hi
    prefix = "… " if lo > 0 else ""
    suffix = " …" if hi < len(value) else ""
    shift = len(prefix) - lo
    highlights = []
    for index in sorted(match.matched):
        word_start, word_end = words.starts[index], words.ends[index]
        if word_start >= lo and word_end <= hi:
            span = (word_start + shift, word_end + shift)
            if not highlights or highlights[-1] != span:
                highlights.append(span)
    return Snippet(prefix + value[lo:hi] + suffix, tuple(highlights))


# --- Search -----------------------------------------------------------------

FIELD_WEIGHT = {"title": 3, "description": 2, "text": 1}


@dataclass
class SearchHit:
    document_id: str
    document_title: str
    document_date: str | None
    field: str  # "title" | "description" | "text"
    file_id: str | None
    file_name: str | None
    page: int | None
    snippet: Snippet
    match_count: int
    matched_words: list[str]
    score: float = 0.0


@dataclass
class SearchResult:
    hits: list[SearchHit] = field(default_factory=list)
    total: int = 0
    #: True when more texts matched the index than were checked, so ``total``
    #: is a lower bound.
    truncated: bool = False
    fuzzy: bool = False
    terms: list[str] = field(default_factory=list)


def _score(field_name: str, match: FieldMatch) -> float:
    return (
        FIELD_WEIGHT[field_name] * 1000
        + (200 if match.adjacent else 0)
        + (100 if match.whole_words else 0)
        - 5 * min(match.span, PROXIMITY_WINDOW)
        + 2 * min(match.count, 20)
    )


def _hit(
    *,
    document: tuple[str, str, str | None],
    field_name: str,
    value: str,
    words: Words,
    match: FieldMatch,
    file_id: str | None = None,
    file_name: str | None = None,
    plain: PlainText | None = None,
) -> SearchHit:
    document_id, title, document_date = document
    page = plain.page_at(words.starts[match.first]) if plain is not None else None
    return SearchHit(
        document_id=document_id,
        document_title=title,
        document_date=document_date,
        field=field_name,
        file_id=file_id,
        file_name=file_name,
        page=page,
        snippet=build_snippet(value, words, match),
        match_count=match.count,
        matched_words=sorted({words.folded[i] for i in match.matched}),
        score=_score(field_name, match),
    )


def _text_candidates(
    db: Session,
    workspace_id: str,
    context: WorkspaceAccessContext,
    query: ParsedQuery,
    *,
    fuzzy: bool,
) -> tuple[list, bool]:
    """Rows of (file id, file name, document id, markdown) worth checking,
    and whether the list was cut at :data:`CANDIDATE_LIMIT`."""
    statement = (
        select(
            DocumentFileText.document_file_id,
            DocumentFile.filename,
            DocumentFile.document_id,
            DocumentFileText.markdown,
        )
        .join(DocumentFile, DocumentFile.id == DocumentFileText.document_file_id)
        .join(Document, Document.id == DocumentFile.document_id)
        .where(DocumentFileText.workspace_id == workspace_id)
    )
    content_filter = context.content_filter(
        ContentType.DOCUMENT, Document.id, domain=DOMAIN
    )
    if content_filter is not None:
        statement = statement.where(content_filter)

    if db.get_bind().dialect.name != "postgresql":
        # Tests (SQLite): no index to narrow with; check every visible text.
        return list(db.execute(statement.order_by(DocumentFile.id)).all()), False

    vector = literal_column("document_file_texts.search_vector")
    folded = func.ft_fold(DocumentFileText.markdown)
    exact = [t for t in query.tokens if not fuzzy or len(t) < MIN_FUZZY_LENGTH]
    similar = [t for t in query.tokens if fuzzy and len(t) >= MIN_FUZZY_LENGTH]
    if exact:
        tsquery = func.to_tsquery(
            literal_column("'simple'::regconfig"),
            " & ".join(f"{t}:*" if len(t) >= MIN_PREFIX_LENGTH else t for t in exact),
        )
        statement = statement.where(vector.op("@@")(tsquery))
    if similar:
        db.execute(
            select(
                func.set_config(
                    "pg_trgm.strict_word_similarity_threshold",
                    str(FUZZY_THRESHOLD),
                    True,
                )
            )
        )
        for token in similar:
            statement = statement.where(literal(token, String).op("<<%")(folded))
        statement = statement.order_by(DocumentFile.id)
    else:
        statement = statement.order_by(
            func.ts_rank_cd(vector, tsquery).desc(), DocumentFile.id
        )
    rows = list(db.execute(statement.limit(CANDIDATE_LIMIT + 1)).all())
    return rows[:CANDIDATE_LIMIT], len(rows) > CANDIDATE_LIMIT


def _search(
    db: Session,
    workspace_id: str,
    context: WorkspaceAccessContext,
    query: ParsedQuery,
    *,
    fuzzy: bool,
) -> tuple[list[SearchHit], bool]:
    filters = [Document.workspace_id == workspace_id]
    content_filter = context.content_filter(
        ContentType.DOCUMENT, Document.id, domain=DOMAIN
    )
    if content_filter is not None:
        filters.append(content_filter)
    documents = {
        row.id: (row.id, row.title, row.document_date, row.description)
        for row in db.execute(
            select(
                Document.id, Document.title, Document.document_date, Document.description
            ).where(*filters)
        )
    }

    hits: list[SearchHit] = []
    for document_id, title, document_date, description in documents.values():
        summary = (document_id, title, document_date)
        title_words = words_of(title)
        match = match_field(query, title_words, fuzzy=fuzzy, window=None)
        if match is not None:
            hits.append(
                _hit(
                    document=summary,
                    field_name="title",
                    value=title,
                    words=title_words,
                    match=match,
                )
            )
            continue
        if description:
            plain = _SPACE.sub(" ", description).strip()
            description_words = words_of(plain)
            match = match_field(
                query, description_words, fuzzy=fuzzy, window=PROXIMITY_WINDOW
            )
            if match is not None:
                hits.append(
                    _hit(
                        document=summary,
                        field_name="description",
                        value=plain,
                        words=description_words,
                        match=match,
                    )
                )

    rows, truncated = _text_candidates(db, workspace_id, context, query, fuzzy=fuzzy)
    budget = CHECK_BUDGET_CHARS
    for file_id, file_name, document_id, markdown in rows:
        document = documents.get(document_id)
        if document is None:
            continue
        if budget <= 0:
            truncated = True
            break
        budget -= len(markdown)
        plain = plain_text(markdown)
        text_words = words_of(plain.text)
        match = match_field(query, text_words, fuzzy=fuzzy, window=PROXIMITY_WINDOW)
        if match is None:
            continue
        hits.append(
            _hit(
                document=document[:3],
                field_name="text",
                value=plain.text,
                words=text_words,
                match=match,
                file_id=file_id,
                file_name=file_name,
                plain=plain,
            )
        )
    return hits, truncated


def search_documents(
    db: Session,
    workspace_id: str,
    context: WorkspaceAccessContext,
    q: str,
    *,
    limit: int,
) -> SearchResult:
    query = parse_query(q)
    if not query.terms:
        return SearchResult()
    hits, truncated = _search(db, workspace_id, context, query, fuzzy=False)
    fuzzy = False
    if not hits and any(len(t) >= MIN_FUZZY_LENGTH for t in query.tokens):
        hits, truncated = _search(db, workspace_id, context, query, fuzzy=True)
        fuzzy = True

    hits.sort(key=lambda h: (-h.score, h.document_title.lower(), h.file_name or ""))
    per_document: dict[str, int] = {}
    kept = []
    for hit in hits:
        if hit.field == "text":
            seen = per_document.get(hit.document_id, 0)
            if seen >= MAX_FILES_PER_DOCUMENT:
                continue
            per_document[hit.document_id] = seen + 1
        kept.append(hit)
    return SearchResult(
        hits=kept[:limit],
        total=len(kept),
        truncated=truncated,
        fuzzy=fuzzy,
        terms=query.tokens,
    )
