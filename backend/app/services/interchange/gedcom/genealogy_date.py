"""Structured genealogy date parsing and sort-key derivation.

Genealogy dates are often fuzzy: "about 1850", "before 1900", "circa 1920",
"ABT 1875", etc.  This module provides a lightweight parser that extracts a
qualifier and a zero-padded ``YYYY-MM-DD`` sort key from any stored date
string, enabling reliable lexicographic ordering without altering the original
display value.

Public API
----------
GenealogyDate : dataclass
    Structured representation of a parsed date value.
parse_genealogy_date(value) -> GenealogyDate
    Parse a raw date string into a structured form.
sort_key(value) -> str | None
    Convenience wrapper — returns only the sort key.

Design notes
------------
* Pure module — no database or SQLAlchemy imports so it can be imported freely
  from models, migrations, and services without creating import cycles.
* The *original* display value is always preserved unchanged; only the derived
  ``sort_key`` and ``qualifier`` fields are added.
* Month abbreviations mirror the ``MONTHS`` list used by ``gedcom.py`` but are
  kept self-contained so neither module depends on the other.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["GenealogyDate", "parse_genealogy_date", "sort_key"]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Ordered list of three-letter month abbreviations (GEDCOM-compatible).
_MONTHS: list[str] = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
]

_MONTH_TO_NUM: dict[str, str] = {m: f"{i + 1:02d}" for i, m in enumerate(_MONTHS)}

# ---------------------------------------------------------------------------
# Qualifier literals
# ---------------------------------------------------------------------------

#: Canonical qualifier strings returned by this module.
Qualifier = str  # one of the values below

QUALIFIER_EXACT = "exact"
QUALIFIER_ABOUT = "about"
QUALIFIER_BEFORE = "before"
QUALIFIER_AFTER = "after"
QUALIFIER_BETWEEN = "between"
QUALIFIER_ESTIMATED = "estimated"

# Keyword sets, all matched case-insensitively.
_ABOUT_TOKENS: frozenset[str] = frozenset(
    {"about", "abt", "circa", "ca", "ca.", "c.", "~"}
)
_BEFORE_TOKENS: frozenset[str] = frozenset({"before", "bef", "<"})
_AFTER_TOKENS: frozenset[str] = frozenset({"after", "aft", ">"})
_BETWEEN_TOKENS: frozenset[str] = frozenset({"between", "bet"})
_ESTIMATED_TOKENS: frozenset[str] = frozenset({"estimated", "est", "calculated", "cal"})


# ---------------------------------------------------------------------------
# Dataclass
# ---------------------------------------------------------------------------


@dataclass
class GenealogyDate:
    """Structured representation of a parsed genealogy date.

    Attributes
    ----------
    original:
        The raw input string, preserved exactly as supplied.
    qualifier:
        One of the ``QUALIFIER_*`` constants: ``"exact"``, ``"about"``,
        ``"before"``, ``"after"``, ``"between"``, or ``"estimated"``.
    sort_key:
        A zero-padded ``YYYY-MM-DD`` string suitable for lexicographic
        sorting, or ``None`` when no year can be recovered.

        * Full ISO date ``"1950-06-15"`` → ``"1950-06-15"``
        * Year-month ``"1950-06"`` → ``"1950-06-00"``
        * Year-only ``"1950"`` → ``"1950-00-00"``
        * GEDCOM-style ``"15 JUN 1950"`` → ``"1950-06-15"``
        * GEDCOM-style ``"JUN 1950"`` → ``"1950-06-00"``
        * Fuzzy / qualified (e.g. ``"about 1850"``) → ``"1850-00-00"``
        * No recoverable year → ``None``
    """

    original: str
    qualifier: Qualifier
    sort_key: str | None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _detect_qualifier(value: str) -> Qualifier:
    """Return the qualifier encoded in *value*'s leading token(s)."""
    stripped = value.strip()
    if not stripped:
        return QUALIFIER_EXACT

    # Single-character symbols checked first (no tokenisation needed).
    if stripped.startswith("~"):
        return QUALIFIER_ABOUT
    if stripped.startswith("<"):
        return QUALIFIER_BEFORE
    if stripped.startswith(">"):
        return QUALIFIER_AFTER

    first = stripped.split()[0].lower().rstrip(".")
    # Restore trailing dot for "ca." / "c." matching.
    first_raw = stripped.split()[0].lower()

    if first_raw in _ABOUT_TOKENS or first in _ABOUT_TOKENS:
        return QUALIFIER_ABOUT
    if first_raw in _BEFORE_TOKENS or first in _BEFORE_TOKENS:
        return QUALIFIER_BEFORE
    if first_raw in _AFTER_TOKENS or first in _AFTER_TOKENS:
        return QUALIFIER_AFTER
    if first_raw in _BETWEEN_TOKENS or first in _BETWEEN_TOKENS:
        return QUALIFIER_BETWEEN
    if first_raw in _ESTIMATED_TOKENS or first in _ESTIMATED_TOKENS:
        return QUALIFIER_ESTIMATED

    # Implicit "between": value contains ` or ` / ` and ` connecting dates.
    lower = stripped.lower()
    if " or " in lower or " and " in lower:
        # Only treat as "between" if there is at least one year-like token on
        # each side of the connector.
        if re.search(r"\d{4}", lower):
            return QUALIFIER_BETWEEN

    return QUALIFIER_EXACT


def _build_sort_key(value: str, qualifier: Qualifier) -> str | None:
    """Derive a zero-padded ``YYYY-MM-DD`` sort key from *value*.

    For exact dates the full precision is used; for fuzzy values the first
    recoverable year is used with zero-padded month/day.
    """
    stripped = value.strip()
    if not stripped:
        return None

    # --- Exact / precise formats ---

    # ISO full: YYYY-MM-DD (optionally with time component)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)", stripped)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    # ISO year-month: YYYY-MM
    m = re.fullmatch(r"(\d{4})-(\d{2})", stripped)
    if m:
        return f"{m.group(1)}-{m.group(2)}-00"

    # ISO year-only: YYYY
    m = re.fullmatch(r"(\d{4})", stripped)
    if m:
        return f"{m.group(1)}-00-00"

    # GEDCOM DD MON YYYY
    m = re.fullmatch(r"(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})", stripped)
    if m:
        day, mon_str, year = int(m.group(1)), m.group(2).upper(), m.group(3)
        if mon_str in _MONTH_TO_NUM:
            return f"{year}-{_MONTH_TO_NUM[mon_str]}-{day:02d}"

    # GEDCOM MON YYYY
    m = re.fullmatch(r"([A-Za-z]{3})\s+(\d{4})", stripped)
    if m:
        mon_str, year = m.group(1).upper(), m.group(2)
        if mon_str in _MONTH_TO_NUM:
            return f"{year}-{_MONTH_TO_NUM[mon_str]}-00"

    # --- Qualified / fuzzy: extract the first 4-digit year found ---
    year_match = re.search(r"\b(\d{4})\b", stripped)
    if year_match:
        return f"{year_match.group(1)}-00-00"

    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_genealogy_date(value: str | None) -> GenealogyDate:
    """Parse a genealogy date string into a structured :class:`GenealogyDate`.

    Parameters
    ----------
    value:
        A raw date string as stored in the database (e.g. ``"1950-06-15"``,
        ``"ABT 1850"``, ``"about 1850"``, ``"before 1900"``, ``"15 JUN 1950"``),
        or ``None`` / empty string.

    Returns
    -------
    GenealogyDate
        Always returns a :class:`GenealogyDate` instance.  When *value* is
        ``None`` or empty the qualifier is ``"exact"`` and ``sort_key`` is
        ``None``.
    """
    if not value:
        return GenealogyDate(
            original=value or "", qualifier=QUALIFIER_EXACT, sort_key=None
        )

    qualifier = _detect_qualifier(value)
    sk = _build_sort_key(value, qualifier)
    return GenealogyDate(original=value, qualifier=qualifier, sort_key=sk)


def sort_key(value: str | None) -> str | None:
    """Return the lexicographic sort key for *value*, or ``None``.

    Convenience wrapper around :func:`parse_genealogy_date` for callers that
    only need the sort key.

    Parameters
    ----------
    value:
        Raw date string or ``None``.

    Returns
    -------
    str | None
        A zero-padded ``YYYY-MM-DD`` string, or ``None`` when no year can be
        recovered (including for ``None`` / empty input).
    """
    return parse_genealogy_date(value).sort_key
