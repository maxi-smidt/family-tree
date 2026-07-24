"""GEDCOM 5.5.1 (LINEAGE-LINKED) serializer and parser.

Operates entirely on plain dicts — no DB or SQLAlchemy imports.

Public API
----------
serialize_to_gedcom(tree_name, members, relations, documents=, document_files=,
                     citations=) -> str
parse_gedcom(text) -> {"members": [...], "relations": [...]}
"""

from __future__ import annotations

import re
from datetime import date
from uuid import uuid4

from app.services.bundle_types import (
    GedcomCitation,
    GedcomDocument,
    GedcomDocumentFile,
    GedcomMember,
    GedcomParseResult,
    GedcomRecord,
    GedcomRelation,
)
from app.services.genealogy_date import sort_key

__all__ = ["serialize_to_gedcom", "parse_gedcom", "decode_gedcom_bytes"]


# ---------------------------------------------------------------------------
# Encoding detection
# ---------------------------------------------------------------------------

def decode_gedcom_bytes(raw: bytes) -> str:
    """Decode raw GEDCOM bytes to a Unicode string.

    GEDCOM encoding landscape
    -------------------------
    GEDCOM 5.5.1 mandates UTF-8 or ANSEL; real-world files also use UTF-16
    (Windows genealogy apps) and Latin-1.  The ``1 CHAR`` header tag names the
    encoding but is unreliable — we detect it from the BOM and, as a fallback,
    from NUL-byte heuristics:

    * UTF-8 BOM  (``EF BB BF``)            → decode as ``utf-8-sig``
    * UTF-16 LE BOM  (``FF FE``)           → decode as ``utf-16`` (Python picks
      the right endianness from the BOM)
    * UTF-16 BE BOM  (``FE FF``)           → same — ``utf-16`` handles both
    * No BOM, no NUL bytes                 → try ``utf-8``, fall back to
      ``latin-1``
    * No BOM, NUL bytes in first 64 bytes  → BOM-less UTF-16; try
      ``utf-16-le``, then ``utf-16-be``, then ``latin-1``
    """
    # --- BOM-based detection ------------------------------------------------
    if raw[:3] == b"\xef\xbb\xbf":
        # UTF-8 with BOM
        return raw.decode("utf-8-sig")

    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        # UTF-16 with BOM (LE or BE); Python's utf-16 codec reads the BOM and
        # strips it automatically.
        return raw.decode("utf-16")

    # --- No BOM: try UTF-8 first --------------------------------------------
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        pass

    # --- Heuristic for BOM-less UTF-16 (NUL bytes present) -----------------
    if b"\x00" in raw[:64]:
        for enc in ("utf-16-le", "utf-16-be"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue

    # --- Final fallback: Latin-1 (never raises) -----------------------------
    return raw.decode("latin-1")


# ---------------------------------------------------------------------------
# Month tables
# ---------------------------------------------------------------------------

MONTHS: list[str] = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
]

_MONTH_TO_NUM: dict[str, str] = {m: f"{i+1:02d}" for i, m in enumerate(MONTHS)}

# GEDCOM date qualifiers that we pass through verbatim.
_DATE_QUALIFIERS = {"ABT", "EST", "CAL", "BEF", "AFT", "FROM", "TO"}

# Couple relation types that map to FAM records.
_COUPLE_TYPES: frozenset[str] = frozenset({"married", "partner", "divorced"})

# Xref of the submitter record required by the GEDCOM 5.5.1 header.
SUBMITTER_XREF = "@SUBM1@"


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def _to_gedcom_date(s: str | None) -> str | None:
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


def _from_gedcom_date(s: str | None) -> str | None:
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


# ---------------------------------------------------------------------------
# Serializer
# ---------------------------------------------------------------------------

def serialize_to_gedcom(
    tree_name: str,
    members: list[GedcomMember],
    relations: list[GedcomRelation],
    documents: list[GedcomDocument] | None = None,
    document_files: list[GedcomDocumentFile] | None = None,
    citations: list[GedcomCitation] | None = None,
    app_version: str | None = None,
) -> str:
    """Serialize a family tree to a GEDCOM 5.5.1 LINEAGE-LINKED string.

    Parameters
    ----------
    tree_name:
        Display name of the tree (used in HEAD FILE and FAM logic).
    members:
        List of member dicts matching the ``Member`` model columns.
    relations:
        List of relation dicts matching the ``Relation`` model columns.

    Returns
    -------
    str
        Complete GEDCOM text, lines separated by ``\\n``, ending with ``0 TRLR``.
    """
    lines: list[str] = []

    def L(line: str) -> None:  # noqa: N802
        lines.append(line)

    # --- HEAD -----------------------------------------------------------------
    today = date.today()
    day_str = f"{today.day:02d} {MONTHS[today.month - 1]} {today.year}"
    L("0 HEAD")
    L("1 SOUR FamilyTree")
    L("2 NAME Family Tree")
    if app_version:
        L(f"2 VERS {app_version}")
    L("1 GEDC")
    L("2 VERS 5.5.1")
    L("2 FORM LINEAGE-LINKED")
    L("1 CHAR UTF-8")
    L(f"1 DATE {day_str}")
    # GEDCOM 5.5.1 requires a submitter reference in the header (cardinality
    # {1:1}) backed by a SUBM record; emitted at the end before TRLR.
    L(f"1 SUBM {SUBMITTER_XREF}")
    L(f"1 FILE {tree_name}")

    # --- Assign INDI xrefs ---------------------------------------------------
    member_xref: dict[str, str] = {}  # member_id → "@I{n}@"
    for idx, member in enumerate(members, start=1):
        member_xref[member["id"]] = f"@I{idx}@"

    # --- Assign SOUR xrefs and build citations index -------------------------
    # "Documents" replaces the old Source/Citation/Evidence model: each
    # Document becomes a GEDCOM SOUR record, its files become OBJE multimedia
    # links, and each mentioned member gets a plain SOUR citation (no
    # PAGE/fact-type granularity — that concept doesn't exist on Documents).
    documents = documents or []
    document_files = document_files or []
    citations = citations or []
    source_xref: dict[str, str] = {}
    for idx, doc in enumerate(documents, start=1):
        source_xref[doc["id"]] = f"@S{idx}@"
    # member_id → list of source_xref
    member_citations: dict[str, list[str]] = {}
    for cit in citations:
        doc_id = cit.get("document_id", "")
        xref = source_xref.get(doc_id)
        if xref is None:
            continue
        mem_id = cit.get("member_id", "")
        member_citations.setdefault(mem_id, []).append(xref)
    # document_id → list of file dicts (kind == "file" only; links are external
    # URLs and have no place in a MULTIMEDIA_LINK).
    files_by_document: dict[str, list[GedcomDocumentFile]] = {}
    for f in document_files:
        files_by_document.setdefault(f.get("document_id", ""), []).append(f)

    # --- Build family groups -------------------------------------------------
    # A family is keyed by a frozenset of spouse ids (1 or 2 members).
    # families: key → {"spouses": set[str], "children": list[str],
    #                   "couple_type": str|None}
    families: dict[frozenset, dict] = {}

    # Step 1: parent relations → map each child to its parents.
    child_parents: dict[str, list[str]] = {}
    for rel in relations:
        if rel["relation_type"] != "parent":
            continue
        child_id = rel["from_member_id"]
        parent_id = rel["to_member_id"]
        child_parents.setdefault(child_id, []).append(parent_id)

    # For each child, determine the family key.
    for child_id, parents in child_parents.items():
        # Limit to 2 parents (GEDCOM FAM supports at most HUSB + WIFE).
        key = frozenset(parents[:2])
        if key not in families:
            families[key] = {
                "spouses": set(parents[:2]),
                "children": [],
                "couple_type": None,
            }
        families[key]["children"].append(child_id)

    # Step 2: couple relations → create or update FAM.
    for rel in relations:
        if rel["relation_type"] not in _COUPLE_TYPES:
            continue
        sp1, sp2 = rel["from_member_id"], rel["to_member_id"]
        key = frozenset([sp1, sp2])
        if key not in families:
            families[key] = {
                "spouses": {sp1, sp2},
                "children": [],
                "couple_type": rel["relation_type"],
            }
        else:
            families[key]["couple_type"] = rel["relation_type"]

    # Assign @F{n}@ xrefs deterministically.
    # Sort families by sorted member xrefs for stability.
    def _family_sort_key(item: tuple[frozenset, dict]) -> tuple:
        key_set, fam = item
        return tuple(sorted(member_xref.get(mid, mid) for mid in key_set))

    sorted_families = sorted(families.items(), key=_family_sort_key)
    fam_xref: dict[frozenset, str] = {}
    for idx, (key, _) in enumerate(sorted_families, start=1):
        fam_xref[key] = f"@F{idx}@"

    # --- Member id → family sets (for FAMC/FAMS pointers) -------------------
    # child → list of fam xrefs where they appear as CHIL
    child_in_fams: dict[str, list[str]] = {}
    # spouse → list of fam xrefs where they appear as HUSB/WIFE
    spouse_in_fams: dict[str, list[str]] = {}

    for key, fam in sorted_families:
        fx = fam_xref[key]
        for child_id in fam["children"]:
            child_in_fams.setdefault(child_id, []).append(fx)
        for sp_id in fam["spouses"]:
            spouse_in_fams.setdefault(sp_id, []).append(fx)

    # --- Member id map for gender lookup ------------------------------------
    member_by_id: dict[str, GedcomMember] = {m["id"]: m for m in members}

    # --- INDI records -------------------------------------------------------
    for member in members:
        xref = member_xref[member["id"]]
        L(f"0 {xref} INDI")

        first = (member.get("first_name") or "").strip()
        middle = (member.get("middle_names") or "").strip()
        given_names = " ".join(part for part in (first, middle) if part)
        last = (member.get("last_name") or "").strip()
        # Primary NAME
        name_value = f"{given_names} /{last}/" if given_names or last else "//"
        L(f"1 NAME {name_value}")
        if given_names:
            L(f"2 GIVN {given_names}")
        if first:
            L(f"2 _FIRST_NAME {first}")
        if middle:
            L(f"2 _MIDDLE_NAMES {middle}")
        if last:
            L(f"2 SURN {last}")

        # Baptismal name (alternate NAME tag).
        baptismal = (member.get("baptismal_name") or "").strip()
        if baptismal:
            baptismal_value = f"{baptismal} /{last}/" if last else baptismal
            L(f"1 NAME {baptismal_value}")
            L("2 TYPE baptismal")
            L(f"2 GIVN {baptismal}")
            if last:
                L(f"2 SURN {last}")

        # Maiden name (second NAME tag)
        maiden = (member.get("maiden_name") or "").strip()
        if maiden:
            maiden_value = (
                f"{given_names} /{maiden}/" if given_names else f"/{maiden}/"
            )
            L(f"1 NAME {maiden_value}")
            L("2 TYPE maiden")
            if given_names:
                L(f"2 GIVN {given_names}")
            L(f"2 SURN {maiden}")

        # TITL (academic / honorific title)
        title = (member.get("academic_title") or "").strip()
        if title:
            L(f"1 TITL {title}")

        # SEX
        gender = member.get("gender")
        if gender == "m":
            L("1 SEX M")
        elif gender == "f":
            L("1 SEX F")
        else:
            L("1 SEX U")
            if gender == "o":
                L("1 _GENDER o")

        # BIRT
        dob_ged = _to_gedcom_date(member.get("date_of_birth"))
        birthplace = (member.get("birthplace") or "").strip()
        if dob_ged or birthplace:
            L("1 BIRT")
            if dob_ged:
                L(f"2 DATE {dob_ged}")
            if birthplace:
                L(f"2 PLAC {birthplace}")

        # DEAT
        dod_ged = _to_gedcom_date(member.get("date_of_death"))
        if dod_ged:
            L("1 DEAT")
            L(f"2 DATE {dod_ged}")
        elif member.get("deceased"):
            L("1 DEAT Y")

        # BURI
        cemetery = (member.get("cemetery") or "").strip()
        if cemetery:
            L("1 BURI")
            L(f"2 PLAC {cemetery}")

        # RESI
        hometown = (member.get("hometown") or "").strip()
        if hometown:
            L("1 RESI")
            L(f"2 PLAC {hometown}")

        # NOTE
        note = (member.get("additional_data") or "").strip()
        if note:
            note_lines = note.splitlines()
            L(f"1 NOTE {note_lines[0]}")
            for cont_line in note_lines[1:]:
                L(f"2 CONT {cont_line}")

        # Source (Document) citations at individual level.
        mid = member["id"]
        for sx in member_citations.get(mid, []):
            L(f"1 SOUR {sx}")

        # Adoption event — emitted before FAMC so readers see ADOP in the
        # individual record regardless of whether a family link exists.
        if member.get("adopted"):
            L("1 ADOP")

        # FAMC / FAMS pointers
        for fx in child_in_fams.get(mid, []):
            L(f"1 FAMC {fx}")
            if member.get("adopted"):
                L("2 PEDI adopted")
        for fx in spouse_in_fams.get(mid, []):
            L(f"1 FAMS {fx}")

    # --- FAM records --------------------------------------------------------
    for key, fam in sorted_families:
        fx = fam_xref[key]
        L(f"0 {fx} FAM")

        # Determine HUSB / WIFE assignment.
        spouses = list(fam["spouses"])
        husb_id: str | None = None
        wife_id: str | None = None

        if len(spouses) == 1:
            sp = spouses[0]
            gender = member_by_id.get(sp, {}).get("gender")
            if gender == "f":
                wife_id = sp
            else:
                husb_id = sp
        else:
            # Two spouses — assign by gender.
            for sp in spouses:
                gender = member_by_id.get(sp, {}).get("gender")
                if gender == "m" and husb_id is None:
                    husb_id = sp
                elif gender == "f" and wife_id is None:
                    wife_id = sp
            # If still unassigned (both same gender / unknown), use sorted order.
            if husb_id is None and wife_id is None:
                s1, s2 = sorted(spouses)
                husb_id, wife_id = s1, s2
            elif husb_id is None:
                husb_id = next(s for s in spouses if s != wife_id)
            elif wife_id is None:
                wife_id = next(s for s in spouses if s != husb_id)

        if husb_id and husb_id in member_xref:
            L(f"1 HUSB {member_xref[husb_id]}")
        if wife_id and wife_id in member_xref:
            L(f"1 WIFE {member_xref[wife_id]}")

        # Children sorted for determinism.
        for child_id in sorted(fam["children"], key=lambda c: member_xref.get(c, c)):
            if child_id in member_xref:
                L(f"1 CHIL {member_xref[child_id]}")

        # Couple event / custom relation-type tag.
        couple_type = fam.get("couple_type")
        if couple_type:
            L(f"1 _RELTYPE {couple_type}")
            # A family event with no detail substructures takes the value "Y"
            # in GEDCOM 5.5.1 to assert that it occurred.
            if couple_type == "married":
                L("1 MARR Y")
            elif couple_type == "divorced":
                L("1 MARR Y")
                L("1 DIV Y")
            # "partner" → only _RELTYPE, no MARR

    # --- Generic _REL records (sibling, other, custom) ----------------------
    rel_idx = 1
    parent_pairs: set[tuple[str, str]] = set()
    couple_pairs: set[frozenset] = set()

    for rel in relations:
        if rel["relation_type"] == "parent":
            parent_pairs.add((rel["from_member_id"], rel["to_member_id"]))
        elif rel["relation_type"] in _COUPLE_TYPES:
            couple_pairs.add(frozenset([rel["from_member_id"], rel["to_member_id"]]))

    for rel in relations:
        rtype = rel["relation_type"]
        from_id = rel["from_member_id"]
        to_id = rel["to_member_id"]

        # Skip relations already captured in FAM records.
        if rtype == "parent" and (from_id, to_id) in parent_pairs:
            continue
        if rtype in _COUPLE_TYPES and frozenset([from_id, to_id]) in couple_pairs:
            continue

        if from_id not in member_xref or to_id not in member_xref:
            continue

        L(f"0 @R{rel_idx}@ _REL")
        L(f"1 _FROM {member_xref[from_id]}")
        L(f"1 _TO {member_xref[to_id]}")
        L(f"1 _TYPE {rtype}")
        rel_idx += 1

    # --- SOUR records (one per Document) -------------------------------------
    for doc in documents:
        sx = source_xref.get(doc["id"])
        if not sx:
            continue
        L(f"0 {sx} SOUR")
        if doc.get("title"):
            L(f"1 TITL {doc['title']}")
        # No core GEDCOM 5.5.1 tag carries a source-level date; a private-use
        # tag (matching this file's existing _FIRST_NAME / _RELTYPE style)
        # keeps it out of the file without inventing ambiguous semantics.
        doc_date_ged = _to_gedcom_date(doc.get("document_date"))
        if doc_date_ged:
            L(f"1 _DATE {doc_date_ged}")
        if doc.get("description"):
            note_lines = doc["description"].splitlines()
            L(f"1 NOTE {note_lines[0]}")
            for cont in note_lines[1:]:
                L(f"2 CONT {cont}")
        for f in files_by_document.get(doc["id"], []):
            if not f.get("url"):
                continue
            L("1 OBJE")
            L(f"2 FILE {f['url']}")
            if f.get("mime_type"):
                L(f"3 FORM {f['mime_type']}")
            if f.get("filename"):
                L(f"2 TITL {f['filename']}")

    # --- SUBM record (required by the header reference) ---------------------
    L(f"0 {SUBMITTER_XREF} SUBM")
    L("1 NAME FamilyTree")

    # --- TRLR ---------------------------------------------------------------
    L("0 TRLR")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def _parse_lines(text: str) -> list[tuple[int, str | None, str, str]]:
    """Parse raw GEDCOM text into (level, xref, tag, value) tuples."""
    result: list[tuple[int, str | None, str, str]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        # Split into tokens; we need to preserve multi-word values so we
        # parse positionally and rebuild the value from the remaining tokens.
        tokens = line.split()
        if not tokens:
            continue
        try:
            level = int(tokens[0])
        except ValueError:
            continue  # ignore malformed lines

        pos = 1  # current position in tokens
        xref: str | None = None
        if (
            pos < len(tokens)
            and tokens[pos].startswith("@")
            and tokens[pos].endswith("@")
            and len(tokens[pos]) > 2
        ):
            xref = tokens[pos]
            pos += 1

        if pos >= len(tokens):
            continue
        tag = tokens[pos]
        pos += 1
        # Everything remaining is the value (preserving original spacing as
        # a single space between tokens, which is GEDCOM-conformant).
        value = " ".join(tokens[pos:]) if pos < len(tokens) else ""
        result.append((level, xref, tag, value))
    return result


def _build_record_tree(
    parsed: list[tuple[int, str | None, str, str]],
    start: int,
    base_level: int,
) -> tuple[GedcomRecord, int]:
    """Recursively build a nested record from the flat parsed lines.

    Returns the record dict and the index of the next unprocessed line.
    The record has keys ``"xref"``, ``"tag"``, ``"value"``, and ``"children"``.
    """
    level, xref, tag, value = parsed[start]
    record: GedcomRecord = {"xref": xref, "tag": tag, "value": value, "children": []}
    idx = start + 1
    while idx < len(parsed):
        child_level = parsed[idx][0]
        if child_level <= base_level:
            break
        child, idx = _build_record_tree(parsed, idx, child_level)
        record["children"].append(child)
    return record, idx


def _child_value(record: GedcomRecord, tag: str) -> str | None:
    """Return the first child's value that matches *tag*, or None."""
    for child in record.get("children", []):
        if child["tag"] == tag:
            return child["value"] or None
    return None


def _all_child_values(record: GedcomRecord, tag: str) -> list[str]:
    """Return all child values matching *tag*."""
    return [c["value"] for c in record.get("children", []) if c["tag"] == tag]


def parse_gedcom(text: str) -> GedcomParseResult:
    """Parse a GEDCOM 5.5.1 string into member and relation dicts.

    Parameters
    ----------
    text:
        Raw GEDCOM text (UTF-8 or latin-1).

    Returns
    -------
    dict with keys ``"members"`` and ``"relations"``, each a list of plain dicts
    whose keys align with the ``Member`` / ``Relation`` model columns.
    """
    parsed = _parse_lines(text)
    if not parsed:
        return {"members": [], "relations": []}

    # Split into top-level records (level 0).
    top_records: list[GedcomRecord] = []
    idx = 0
    while idx < len(parsed):
        if parsed[idx][0] == 0:
            record, idx = _build_record_tree(parsed, idx, 0)
            top_records.append(record)
        else:
            idx += 1

    # Capture HEAD FILE name for fallback tree name (stored on the returned
    # dict as a private key so the caller can use it; ignored by DB code).
    head_file_name: str | None = None
    for rec in top_records:
        if rec["tag"] == "HEAD":
            head_file_name = _child_value(rec, "FILE")
            break

    # --- Pass 1: INDI records -----------------------------------------------
    xref_to_member_id: dict[str, str] = {}  # "@I1@" → new uuid
    members: list[GedcomMember] = []

    for rec in top_records:
        if rec["tag"] != "INDI":
            continue
        xref = rec["xref"]
        if not xref:
            continue

        new_id = str(uuid4())
        xref_to_member_id[xref] = new_id

        member: GedcomMember = {
            "id": new_id,
            "academic_title": None,
            "first_name": None,
            "middle_names": None,
            "baptismal_name": None,
            "last_name": None,
            "maiden_name": None,
            "gender": None,
            "date_of_birth": None,
            "date_of_death": None,
            "date_of_birth_sort": None,
            "date_of_death_sort": None,
            "deceased": False,
            "birthplace": None,
            "hometown": None,
            "cemetery": None,
            "additional_data": None,
            "places_lived": None,
            "image_data": None,
            "is_collapsed": False,
            "position_x": 0.0,
            "position_y": 0.0,
            "adopted": False,
        }

        primary_name_done = False
        for child in rec["children"]:
            tag = child["tag"]

            if tag == "NAME":
                raw_name = child["value"] or ""
                # Parse: "Given /Surname/" → given before first '/', surname between '/'
                given = ""
                surname = ""
                m = re.match(r"^(.*?)\s*/([^/]*)/", raw_name)
                if m:
                    given = m.group(1).strip()
                    surname = m.group(2).strip()
                else:
                    given = raw_name.strip()

                # Override GIVN/SURN subtags if present.
                givn = _child_value(child, "GIVN")
                surn = _child_value(child, "SURN")
                if givn is not None:
                    given = givn.strip()
                if surn is not None:
                    surname = surn.strip()

                name_type = _child_value(child, "TYPE")
                if name_type and name_type.lower() == "maiden":
                    member["maiden_name"] = surname or None
                elif name_type and name_type.lower() == "baptismal":
                    member["baptismal_name"] = given or None
                elif not primary_name_done:
                    first_name = _child_value(child, "_FIRST_NAME")
                    middle_names = _child_value(child, "_MIDDLE_NAMES")
                    baptismal_name = _child_value(child, "_BAPTISMAL_NAME")
                    if first_name is not None or middle_names is not None:
                        member["first_name"] = (
                            first_name.strip() if first_name else None
                        )
                        member["middle_names"] = (
                            middle_names.strip() if middle_names else None
                        )
                    else:
                        given_parts = given.split(maxsplit=1)
                        member["first_name"] = given_parts[0] if given_parts else None
                        member["middle_names"] = (
                            given_parts[1] if len(given_parts) > 1 else None
                        )
                    if baptismal_name is not None:
                        member["baptismal_name"] = baptismal_name.strip() or None
                    member["last_name"] = surname or None
                    primary_name_done = True

            elif tag == "TITL":
                val = (child["value"] or "").strip()
                if val:
                    member["academic_title"] = val

            elif tag == "SEX":
                val = (child["value"] or "").strip().upper()
                # Check for custom _GENDER subtag first (set after SEX).
                gender_custom = _child_value(child, "_GENDER")
                if gender_custom is not None:
                    member["gender"] = gender_custom.strip()
                elif val == "M":
                    member["gender"] = "m"
                elif val == "F":
                    member["gender"] = "f"
                else:
                    member["gender"] = None

            elif tag == "_GENDER":
                # Top-level _GENDER tag (emitted alongside SEX U for "o").
                member["gender"] = (child["value"] or "").strip() or None

            elif tag == "BIRT":
                date_val = _child_value(child, "DATE")
                if date_val:
                    member["date_of_birth"] = _from_gedcom_date(date_val)
                plac_val = _child_value(child, "PLAC")
                if plac_val:
                    member["birthplace"] = plac_val.strip()

            elif tag == "DEAT":
                member["deceased"] = True
                date_val = _child_value(child, "DATE")
                if date_val:
                    member["date_of_death"] = _from_gedcom_date(date_val)

            elif tag == "RESI":
                plac_val = _child_value(child, "PLAC")
                if plac_val:
                    member["hometown"] = plac_val.strip()

            elif tag == "BURI":
                plac_val = _child_value(child, "PLAC")
                if plac_val:
                    member["cemetery"] = plac_val.strip()

            elif tag == "NOTE":
                # Rebuild value including CONT lines.
                parts = [child["value"] or ""]
                for cont in child.get("children", []):
                    if cont["tag"] == "CONT":
                        parts.append(cont["value"] or "")
                    elif cont["tag"] == "CONC":
                        parts[-1] = parts[-1] + (cont["value"] or "")
                member["additional_data"] = "\n".join(parts).strip() or None

            elif tag == "ADOP":
                member["adopted"] = True

            elif tag == "FAMC":
                pedi = _child_value(child, "PEDI")
                if pedi and pedi.strip().lower() == "adopted":
                    member["adopted"] = True

        member["date_of_birth_sort"] = sort_key(member["date_of_birth"])
        member["date_of_death_sort"] = sort_key(member["date_of_death"])
        members.append(member)

    # --- Pass 2: FAM records ------------------------------------------------
    relations: list[GedcomRelation] = []
    seen_couple_pairs: set[frozenset] = set()
    seen_parent_pairs: set[tuple[str, str]] = set()

    for rec in top_records:
        if rec["tag"] != "FAM":
            continue

        husb_xrefs = _all_child_values(rec, "HUSB")
        wife_xrefs = _all_child_values(rec, "WIFE")
        chil_xrefs = _all_child_values(rec, "CHIL")

        husb_ids = [xref_to_member_id[x] for x in husb_xrefs if x in xref_to_member_id]
        wife_ids = [xref_to_member_id[x] for x in wife_xrefs if x in xref_to_member_id]
        chil_ids = [xref_to_member_id[x] for x in chil_xrefs if x in xref_to_member_id]

        spouse_ids = husb_ids[:1] + wife_ids[:1]  # at most one each

        # Determine couple relation type.
        reltype_tag = _child_value(rec, "_RELTYPE")
        has_marr = any(c["tag"] == "MARR" for c in rec.get("children", []))
        has_div = any(c["tag"] == "DIV" for c in rec.get("children", []))

        if reltype_tag:
            couple_type: str | None = reltype_tag.strip()
        elif has_div:
            couple_type = "divorced"
        elif has_marr:
            couple_type = "married"
        elif len(spouse_ids) == 2:
            # Two spouses but no explicit relation tags — common in third-party
            # GEDCOMs that link spouses only via shared CHIL. Default to "married"
            # so the union node renders green instead of grey. (#295)
            couple_type = "married"
        else:
            couple_type = None  # parent-only family; no couple relation

        # Couple relation (at most one between a pair).
        if couple_type and len(spouse_ids) == 2:
            pair = frozenset(spouse_ids)
            if pair not in seen_couple_pairs:
                seen_couple_pairs.add(pair)
                relations.append({
                    "from_member_id": spouse_ids[0],
                    "to_member_id": spouse_ids[1],
                    "relation_type": couple_type,
                })
        elif couple_type and len(spouse_ids) == 1:
            # Single-spouse with explicit partner type? Unlikely but guard.
            pass

        # Parent-child relations: from=child, to=parent.
        for child_id in chil_ids:
            for parent_id in spouse_ids:
                pair = (child_id, parent_id)
                if pair not in seen_parent_pairs:
                    seen_parent_pairs.add(pair)
                    relations.append({
                        "from_member_id": child_id,
                        "to_member_id": parent_id,
                        "relation_type": "parent",
                    })

    # --- Pass 3: _REL records -----------------------------------------------
    for rec in top_records:
        if rec["tag"] != "_REL":
            continue

        from_xref = _child_value(rec, "_FROM")
        to_xref = _child_value(rec, "_TO")
        rel_type = _child_value(rec, "_TYPE")

        if not from_xref or not to_xref or not rel_type:
            continue

        # Skip horizontal relation types that are now derived from the parent
        # graph rather than stored as explicit rows.
        if rel_type.strip() in ("sibling", "half-sibling", "step-sibling"):
            continue

        from_id = xref_to_member_id.get(from_xref)
        to_id = xref_to_member_id.get(to_xref)
        if not from_id or not to_id:
            continue

        # De-duplicate.
        rel_entry = {
            "from_member_id": from_id,
            "to_member_id": to_id,
            "relation_type": rel_type.strip(),
        }
        if rel_entry not in relations:
            relations.append(rel_entry)

    result: GedcomParseResult = {"members": members, "relations": relations}
    if head_file_name:
        result["_head_file"] = head_file_name
    return result
