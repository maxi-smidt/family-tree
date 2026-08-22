"""GEDCOM 5.5.1 serialization: tree data (plain dicts) → GEDCOM text.

``serialize_to_gedcom`` is the public entry point; the rest of this module
breaks the work into focused steps (xref assignment, family grouping,
per-record-type writers) that it composes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from app.services.interchange.bundles.bundle_types import (
    GedcomCitation,
    GedcomDocument,
    GedcomDocumentFile,
    GedcomMember,
    GedcomRelation,
)
from app.services.interchange.gedcom.gedcom_dates import MONTHS, to_gedcom_date

# Couple relation types that map to FAM records.
_COUPLE_TYPES: frozenset[str] = frozenset({"married", "partner", "divorced"})

# Xref of the submitter record required by the GEDCOM 5.5.1 header.
SUBMITTER_XREF = "@SUBM1@"


@dataclass
class _Family:
    """A FAM group being built from relation rows, keyed by spouse-id set."""

    spouses: set[str]
    children: list[str] = field(default_factory=list)
    couple_type: str | None = None


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
    documents = documents or []
    document_files = document_files or []
    citations = citations or []

    lines: list[str] = []
    _write_header(lines, tree_name, app_version)

    member_xref = _assign_member_xrefs(members)
    source_xref, member_citations, files_by_document = _build_citation_index(
        documents, document_files, citations
    )

    families = _build_families(relations)
    sorted_families, fam_xref = _assign_family_xrefs(families, member_xref)
    child_in_fams, spouse_in_fams = _build_family_membership(sorted_families, fam_xref)
    member_by_id: dict[str, GedcomMember] = {m["id"]: m for m in members}

    _write_individuals(
        lines,
        members,
        member_xref,
        member_citations,
        child_in_fams,
        spouse_in_fams,
    )
    _write_families(lines, sorted_families, fam_xref, member_xref, member_by_id)
    _write_generic_relations(lines, relations, member_xref)
    _write_sources(lines, documents, source_xref, files_by_document)

    # SUBM record (required by the header reference).
    lines.append(f"0 {SUBMITTER_XREF} SUBM")
    lines.append("1 NAME FamilyTree")

    lines.append("0 TRLR")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# HEAD
# ---------------------------------------------------------------------------

def _write_header(lines: list[str], tree_name: str, app_version: str | None) -> None:
    today = date.today()
    day_str = f"{today.day:02d} {MONTHS[today.month - 1]} {today.year}"
    lines.append("0 HEAD")
    lines.append("1 SOUR FamilyTree")
    lines.append("2 NAME Family Tree")
    if app_version:
        lines.append(f"2 VERS {app_version}")
    lines.append("1 GEDC")
    lines.append("2 VERS 5.5.1")
    lines.append("2 FORM LINEAGE-LINKED")
    lines.append("1 CHAR UTF-8")
    lines.append(f"1 DATE {day_str}")
    # GEDCOM 5.5.1 requires a submitter reference in the header (cardinality
    # {1:1}) backed by a SUBM record; emitted at the end before TRLR.
    lines.append(f"1 SUBM {SUBMITTER_XREF}")
    lines.append(f"1 FILE {tree_name}")


# ---------------------------------------------------------------------------
# Xref / citation index assignment
# ---------------------------------------------------------------------------

def _assign_member_xrefs(members: list[GedcomMember]) -> dict[str, str]:
    return {member["id"]: f"@I{idx}@" for idx, member in enumerate(members, start=1)}


def _build_citation_index(
    documents: list[GedcomDocument],
    document_files: list[GedcomDocumentFile],
    citations: list[GedcomCitation],
) -> tuple[dict[str, str], dict[str, list[str]], dict[str, list[GedcomDocumentFile]]]:
    """Build SOUR xrefs and lookup tables for member/document cross-refs.

    "Documents" replaces the old Source/Citation/Evidence model: each
    Document becomes a GEDCOM SOUR record, its files become OBJE multimedia
    links, and each mentioned member gets a plain SOUR citation (no
    PAGE/fact-type granularity — that concept doesn't exist on Documents).
    """
    source_xref = {doc["id"]: f"@S{idx}@" for idx, doc in enumerate(documents, start=1)}

    member_citations: dict[str, list[str]] = {}
    for cit in citations:
        xref = source_xref.get(cit.get("document_id", ""))
        if xref is None:
            continue
        mem_id = cit.get("member_id", "")
        member_citations.setdefault(mem_id, []).append(xref)

    # document_id → list of file dicts (kind == "file" only; links are external
    # URLs and have no place in a MULTIMEDIA_LINK).
    files_by_document: dict[str, list[GedcomDocumentFile]] = {}
    for f in document_files:
        files_by_document.setdefault(f.get("document_id", ""), []).append(f)

    return source_xref, member_citations, files_by_document


# ---------------------------------------------------------------------------
# Family grouping
# ---------------------------------------------------------------------------

def _build_families(relations: list[GedcomRelation]) -> dict[frozenset, _Family]:
    """Group parent/couple relations into FAM groups keyed by spouse-id set."""
    families: dict[frozenset, _Family] = {}

    # Step 1: parent relations → map each child to its parents.
    child_parents: dict[str, list[str]] = {}
    for rel in relations:
        if rel["relation_type"] != "parent":
            continue
        child_parents.setdefault(rel["from_member_id"], []).append(rel["to_member_id"])

    # For each child, determine the family key.
    for child_id, parents in child_parents.items():
        # Limit to 2 parents (GEDCOM FAM supports at most HUSB + WIFE).
        key = frozenset(parents[:2])
        family = families.setdefault(key, _Family(spouses=set(parents[:2])))
        family.children.append(child_id)

    # Step 2: couple relations → create or update FAM.
    for rel in relations:
        if rel["relation_type"] not in _COUPLE_TYPES:
            continue
        sp1, sp2 = rel["from_member_id"], rel["to_member_id"]
        key = frozenset([sp1, sp2])
        family = families.setdefault(key, _Family(spouses={sp1, sp2}))
        family.couple_type = rel["relation_type"]

    return families


def _assign_family_xrefs(
    families: dict[frozenset, _Family], member_xref: dict[str, str]
) -> tuple[list[tuple[frozenset, _Family]], dict[frozenset, str]]:
    """Assign deterministic ``@F{n}@`` xrefs, sorted by member xrefs for stability."""

    def sort_key(item: tuple[frozenset, _Family]) -> tuple:
        key_set, _ = item
        return tuple(sorted(member_xref.get(mid, mid) for mid in key_set))

    sorted_families = sorted(families.items(), key=sort_key)
    fam_xref = {key: f"@F{idx}@" for idx, (key, _) in enumerate(sorted_families, start=1)}
    return sorted_families, fam_xref


def _build_family_membership(
    sorted_families: list[tuple[frozenset, _Family]], fam_xref: dict[frozenset, str]
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Map each member id to the FAMC/FAMS xrefs it appears in."""
    child_in_fams: dict[str, list[str]] = {}
    spouse_in_fams: dict[str, list[str]] = {}

    for key, family in sorted_families:
        fx = fam_xref[key]
        for child_id in family.children:
            child_in_fams.setdefault(child_id, []).append(fx)
        for sp_id in family.spouses:
            spouse_in_fams.setdefault(sp_id, []).append(fx)

    return child_in_fams, spouse_in_fams


# ---------------------------------------------------------------------------
# INDI records
# ---------------------------------------------------------------------------

def _write_individuals(
    lines: list[str],
    members: list[GedcomMember],
    member_xref: dict[str, str],
    member_citations: dict[str, list[str]],
    child_in_fams: dict[str, list[str]],
    spouse_in_fams: dict[str, list[str]],
) -> None:
    for member in members:
        _write_individual(
            lines, member, member_xref, member_citations, child_in_fams, spouse_in_fams
        )


def _write_individual(
    lines: list[str],
    member: GedcomMember,
    member_xref: dict[str, str],
    member_citations: dict[str, list[str]],
    child_in_fams: dict[str, list[str]],
    spouse_in_fams: dict[str, list[str]],
) -> None:
    mid = member["id"]
    lines.append(f"0 {member_xref[mid]} INDI")

    first = (member.get("first_name") or "").strip()
    middle = (member.get("middle_names") or "").strip()
    given_names = " ".join(part for part in (first, middle) if part)
    last = (member.get("last_name") or "").strip()
    # Primary NAME
    name_value = f"{given_names} /{last}/" if given_names or last else "//"
    lines.append(f"1 NAME {name_value}")
    if given_names:
        lines.append(f"2 GIVN {given_names}")
    if first:
        lines.append(f"2 _FIRST_NAME {first}")
    if middle:
        lines.append(f"2 _MIDDLE_NAMES {middle}")
    if last:
        lines.append(f"2 SURN {last}")

    # Baptismal name (alternate NAME tag).
    baptismal = (member.get("baptismal_name") or "").strip()
    if baptismal:
        baptismal_value = f"{baptismal} /{last}/" if last else baptismal
        lines.append(f"1 NAME {baptismal_value}")
        lines.append("2 TYPE baptismal")
        lines.append(f"2 GIVN {baptismal}")
        if last:
            lines.append(f"2 SURN {last}")

    # Maiden name (second NAME tag)
    maiden = (member.get("maiden_name") or "").strip()
    if maiden:
        maiden_value = f"{given_names} /{maiden}/" if given_names else f"/{maiden}/"
        lines.append(f"1 NAME {maiden_value}")
        lines.append("2 TYPE maiden")
        if given_names:
            lines.append(f"2 GIVN {given_names}")
        lines.append(f"2 SURN {maiden}")

    # TITL (academic / honorific title)
    title = (member.get("academic_title") or "").strip()
    if title:
        lines.append(f"1 TITL {title}")

    # SEX
    gender = member.get("gender")
    if gender == "m":
        lines.append("1 SEX M")
    elif gender == "f":
        lines.append("1 SEX F")
    else:
        lines.append("1 SEX U")
        if gender == "o":
            lines.append("1 _GENDER o")

    # BIRT
    dob_ged = to_gedcom_date(member.get("date_of_birth"))
    birthplace = (member.get("birthplace") or "").strip()
    if dob_ged or birthplace:
        lines.append("1 BIRT")
        if dob_ged:
            lines.append(f"2 DATE {dob_ged}")
        if birthplace:
            lines.append(f"2 PLAC {birthplace}")

    # DEAT
    dod_ged = to_gedcom_date(member.get("date_of_death"))
    if dod_ged:
        lines.append("1 DEAT")
        lines.append(f"2 DATE {dod_ged}")
    elif member.get("deceased"):
        lines.append("1 DEAT Y")

    # BURI
    cemetery = (member.get("cemetery") or "").strip()
    if cemetery:
        lines.append("1 BURI")
        lines.append(f"2 PLAC {cemetery}")

    # RESI
    hometown = (member.get("hometown") or "").strip()
    if hometown:
        lines.append("1 RESI")
        lines.append(f"2 PLAC {hometown}")

    # NOTE
    note = (member.get("additional_data") or "").strip()
    if note:
        note_lines = note.splitlines()
        lines.append(f"1 NOTE {note_lines[0]}")
        for cont_line in note_lines[1:]:
            lines.append(f"2 CONT {cont_line}")

    # Source (Document) citations at individual level.
    for sx in member_citations.get(mid, []):
        lines.append(f"1 SOUR {sx}")

    # Adoption event — emitted before FAMC so readers see ADOP in the
    # individual record regardless of whether a family link exists.
    if member.get("adopted"):
        lines.append("1 ADOP")

    # FAMC / FAMS pointers
    for fx in child_in_fams.get(mid, []):
        lines.append(f"1 FAMC {fx}")
        if member.get("adopted"):
            lines.append("2 PEDI adopted")
    for fx in spouse_in_fams.get(mid, []):
        lines.append(f"1 FAMS {fx}")


# ---------------------------------------------------------------------------
# FAM records
# ---------------------------------------------------------------------------

def _write_families(
    lines: list[str],
    sorted_families: list[tuple[frozenset, _Family]],
    fam_xref: dict[frozenset, str],
    member_xref: dict[str, str],
    member_by_id: dict[str, GedcomMember],
) -> None:
    for key, family in sorted_families:
        _write_family(lines, fam_xref[key], family, member_xref, member_by_id)


def _assign_husb_wife(
    family: _Family, member_by_id: dict[str, GedcomMember]
) -> tuple[str | None, str | None]:
    spouses = list(family.spouses)
    husb_id: str | None = None
    wife_id: str | None = None

    if len(spouses) == 1:
        sp = spouses[0]
        if member_by_id.get(sp, {}).get("gender") == "f":
            wife_id = sp
        else:
            husb_id = sp
        return husb_id, wife_id

    # Two spouses — assign by gender.
    for sp in spouses:
        gender = member_by_id.get(sp, {}).get("gender")
        if gender == "m" and husb_id is None:
            husb_id = sp
        elif gender == "f" and wife_id is None:
            wife_id = sp
    # If still unassigned (both same gender / unknown), use sorted order.
    if husb_id is None and wife_id is None:
        husb_id, wife_id = sorted(spouses)
    elif husb_id is None:
        husb_id = next(s for s in spouses if s != wife_id)
    elif wife_id is None:
        wife_id = next(s for s in spouses if s != husb_id)
    return husb_id, wife_id


def _write_family(
    lines: list[str],
    fx: str,
    family: _Family,
    member_xref: dict[str, str],
    member_by_id: dict[str, GedcomMember],
) -> None:
    lines.append(f"0 {fx} FAM")

    husb_id, wife_id = _assign_husb_wife(family, member_by_id)
    if husb_id and husb_id in member_xref:
        lines.append(f"1 HUSB {member_xref[husb_id]}")
    if wife_id and wife_id in member_xref:
        lines.append(f"1 WIFE {member_xref[wife_id]}")

    # Children sorted for determinism.
    for child_id in sorted(family.children, key=lambda c: member_xref.get(c, c)):
        if child_id in member_xref:
            lines.append(f"1 CHIL {member_xref[child_id]}")

    # Couple event / custom relation-type tag.
    couple_type = family.couple_type
    if couple_type:
        lines.append(f"1 _RELTYPE {couple_type}")
        # A family event with no detail substructures takes the value "Y"
        # in GEDCOM 5.5.1 to assert that it occurred.
        if couple_type == "married":
            lines.append("1 MARR Y")
        elif couple_type == "divorced":
            lines.append("1 MARR Y")
            lines.append("1 DIV Y")
        # "partner" → only _RELTYPE, no MARR


# ---------------------------------------------------------------------------
# Generic _REL records (sibling, other, custom)
# ---------------------------------------------------------------------------

def _write_generic_relations(
    lines: list[str], relations: list[GedcomRelation], member_xref: dict[str, str]
) -> None:
    parent_pairs: set[tuple[str, str]] = set()
    couple_pairs: set[frozenset] = set()
    for rel in relations:
        if rel["relation_type"] == "parent":
            parent_pairs.add((rel["from_member_id"], rel["to_member_id"]))
        elif rel["relation_type"] in _COUPLE_TYPES:
            couple_pairs.add(frozenset([rel["from_member_id"], rel["to_member_id"]]))

    rel_idx = 1
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

        lines.append(f"0 @R{rel_idx}@ _REL")
        lines.append(f"1 _FROM {member_xref[from_id]}")
        lines.append(f"1 _TO {member_xref[to_id]}")
        lines.append(f"1 _TYPE {rtype}")
        rel_idx += 1


# ---------------------------------------------------------------------------
# SOUR records (one per Document)
# ---------------------------------------------------------------------------

def _write_sources(
    lines: list[str],
    documents: list[GedcomDocument],
    source_xref: dict[str, str],
    files_by_document: dict[str, list[GedcomDocumentFile]],
) -> None:
    for doc in documents:
        sx = source_xref.get(doc["id"])
        if not sx:
            continue
        lines.append(f"0 {sx} SOUR")
        if doc.get("title"):
            lines.append(f"1 TITL {doc['title']}")
        # No core GEDCOM 5.5.1 tag carries a source-level date; a private-use
        # tag (matching this file's existing _FIRST_NAME / _RELTYPE style)
        # keeps it out of the file without inventing ambiguous semantics.
        doc_date_ged = to_gedcom_date(doc.get("document_date"))
        if doc_date_ged:
            lines.append(f"1 _DATE {doc_date_ged}")
        if doc.get("description"):
            note_lines = doc["description"].splitlines()
            lines.append(f"1 NOTE {note_lines[0]}")
            for cont in note_lines[1:]:
                lines.append(f"2 CONT {cont}")
        for f in files_by_document.get(doc["id"], []):
            if not f.get("url"):
                continue
            lines.append("1 OBJE")
            lines.append(f"2 FILE {f['url']}")
            if f.get("mime_type"):
                lines.append(f"3 FORM {f['mime_type']}")
            if f.get("filename"):
                lines.append(f"2 TITL {f['filename']}")
