"""GEDCOM date conversion — stored ISO-ish date strings ↔ GEDCOM date values.

Split out of ``app.services.gedcom`` so the writer and reader modules can
share date handling without depending on each other.
"""

from __future__ import annotations

import re

MONTHS: list[str] = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
]

_MONTH_TO_NUM: dict[str, str] = {m: f"{i+1:02d}" for i, m in enumerate(MONTHS)}

# GEDCOM date qualifiers that we pass through verbatim.
_DATE_QUALIFIERS = {"ABT", "EST", "CAL", "BEF", "AFT", "FROM", "TO"}


def to_gedcom_date(s: str | None) -> str | None:
    """Convert a stored date string to GEDCOM date format.

    ``"1950-06-15"`` → ``"15 JUN 1950"``
    ``"1950-06"``    → ``"JUN 1950"``
    ``"1950"``       → ``"1950"``

    ISO datetimes (``"1950-06-15T..."``): the time component is stripped first.
    Unrecognised patterns are returned unchanged.
    """
    if not s:
        return None
    # Strip ISO time component (YYYY-MM-DDTHH:… only; don't corrupt
    # GEDCOM qualifier prefixes such as "AFT", "EST", "BEF" which also
    # contain the letter "T").
    s = re.sub(r"(\d{4}-\d{2}-\d{2})T.*", r"\1", s).strip()
    # Full date: YYYY-MM-DD
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        year, month, day = m.group(1), int(m.group(2)), int(m.group(3))
        if 1 <= month <= 12:
            return f"{day:02d} {MONTHS[month - 1]} {year}"
    # Year-month: YYYY-MM
    m = re.fullmatch(r"(\d{4})-(\d{2})", s)
    if m:
        year, month = m.group(1), int(m.group(2))
        if 1 <= month <= 12:
            return f"{MONTHS[month - 1]} {year}"
    # Year only: YYYY
    if re.fullmatch(r"\d{4}", s):
        return s
    # Unrecognised — pass through.
    return s


def from_gedcom_date(s: str | None) -> str | None:
    """Convert a GEDCOM date string back to a stored date string.

    ``"15 JUN 1950"`` → ``"1950-06-15"``
    ``"JUN 1950"``    → ``"1950-06"``
    ``"1950"``        → ``"1950"``

    Values starting with GEDCOM qualifiers (ABT, EST, …) are returned verbatim
    so no information is lost.  Unrecognised patterns are returned unchanged.
    """
    if not s:
        return None
    s = s.strip()
    # Qualifier prefix → pass through.
    first = s.split()[0].upper() if s else ""
    if first in _DATE_QUALIFIERS:
        return s
    # DD MON YYYY
    m = re.fullmatch(r"(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})", s)
    if m:
        day, mon_str, year = int(m.group(1)), m.group(2).upper(), m.group(3)
        if mon_str in _MONTH_TO_NUM:
            return f"{year}-{_MONTH_TO_NUM[mon_str]}-{day:02d}"
    # MON YYYY
    m = re.fullmatch(r"([A-Za-z]{3})\s+(\d{4})", s)
    if m:
        mon_str, year = m.group(1).upper(), m.group(2)
        if mon_str in _MONTH_TO_NUM:
            return f"{year}-{_MONTH_TO_NUM[mon_str]}"
    # YYYY
    if re.fullmatch(r"\d{4}", s):
        return s
    return s
