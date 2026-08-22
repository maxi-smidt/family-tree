"""GEDCOM 5.5.1 parsing: GEDCOM text → member/relation dicts.

``parse_gedcom`` is the public entry point; it builds a record tree via
``gedcom_records`` and then walks it in three focused passes (individuals,
families, generic relations) that this module composes.
"""

from __future__ import annotations

import re
from uuid import uuid4

from app.services.interchange.bundles.bundle_types import (
    GedcomMember,
    GedcomParseResult,
    GedcomRecord,
    GedcomRelation,
)
from app.services.interchange.gedcom.gedcom_dates import from_gedcom_date
from app.services.interchange.gedcom.gedcom_records import (
    all_child_values,
    build_record_tree,
    child_value,
    parse_lines,
)
from app.services.interchange.gedcom.genealogy_date import sort_key


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
    parsed = parse_lines(text)
    if not parsed:
        return {"members": [], "relations": []}

    # Split into top-level records (level 0).
    top_records: list[GedcomRecord] = []
    idx = 0
    while idx < len(parsed):
        if parsed[idx][0] == 0:
            record, idx = build_record_tree(parsed, idx, 0)
            top_records.append(record)
        else:
            idx += 1

    # Capture HEAD FILE name for fallback tree name (stored on the returned
    # dict as a private key so the caller can use it; ignored by DB code).
    head_file_name: str | None = None
    for rec in top_records:
        if rec["tag"] == "HEAD":
            head_file_name = child_value(rec, "FILE")
            break

    xref_to_member_id, members = _parse_individuals(top_records)
    relations = _parse_families(top_records, xref_to_member_id)
    relations += _parse_generic_relations(top_records, xref_to_member_id, relations)

    result: GedcomParseResult = {"members": members, "relations": relations}
    if head_file_name:
        result["_head_file"] = head_file_name
    return result


# ---------------------------------------------------------------------------
# Pass 1: INDI records
# ---------------------------------------------------------------------------

def _new_member() -> GedcomMember:
    return {
        "id": str(uuid4()),
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


def _apply_name(
    member: GedcomMember, child: GedcomRecord, primary_name_done: bool
) -> bool:
    """Apply a NAME child record to *member*; return the new primary_name_done."""
    raw_name = child["value"] or ""
    # Parse: "Given /Surname/" → given before first '/', surname between '/'
    m = re.match(r"^(.*?)\s*/([^/]*)/", raw_name)
    if m:
        given = m.group(1).strip()
        surname = m.group(2).strip()
    else:
        given = raw_name.strip()
        surname = ""

    # Override GIVN/SURN subtags if present.
    givn = child_value(child, "GIVN")
    surn = child_value(child, "SURN")
    if givn is not None:
        given = givn.strip()
    if surn is not None:
        surname = surn.strip()

    name_type = child_value(child, "TYPE")
    if name_type and name_type.lower() == "maiden":
        member["maiden_name"] = surname or None
        return primary_name_done
    if name_type and name_type.lower() == "baptismal":
        member["baptismal_name"] = given or None
        return primary_name_done
    if primary_name_done:
        return primary_name_done

    first_name = child_value(child, "_FIRST_NAME")
    middle_names = child_value(child, "_MIDDLE_NAMES")
    baptismal_name = child_value(child, "_BAPTISMAL_NAME")
    if first_name is not None or middle_names is not None:
        member["first_name"] = first_name.strip() if first_name else None
        member["middle_names"] = middle_names.strip() if middle_names else None
    else:
        given_parts = given.split(maxsplit=1)
        member["first_name"] = given_parts[0] if given_parts else None
        member["middle_names"] = given_parts[1] if len(given_parts) > 1 else None
    if baptismal_name is not None:
        member["baptismal_name"] = baptismal_name.strip() or None
    member["last_name"] = surname or None
    return True


def _apply_indi_child(
    member: GedcomMember, tag: str, child: GedcomRecord, primary_name_done: bool
) -> bool:
    """Apply one INDI child record to *member*; return new primary_name_done."""
    if tag == "NAME":
        return _apply_name(member, child, primary_name_done)

    if tag == "TITL":
        val = (child["value"] or "").strip()
        if val:
            member["academic_title"] = val

    elif tag == "SEX":
        val = (child["value"] or "").strip().upper()
        # Check for custom _GENDER subtag first (set after SEX).
        gender_custom = child_value(child, "_GENDER")
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
        date_val = child_value(child, "DATE")
        if date_val:
            member["date_of_birth"] = from_gedcom_date(date_val)
        plac_val = child_value(child, "PLAC")
        if plac_val:
            member["birthplace"] = plac_val.strip()

    elif tag == "DEAT":
        member["deceased"] = True
        date_val = child_value(child, "DATE")
        if date_val:
            member["date_of_death"] = from_gedcom_date(date_val)

    elif tag == "RESI":
        plac_val = child_value(child, "PLAC")
        if plac_val:
            member["hometown"] = plac_val.strip()

    elif tag == "BURI":
        plac_val = child_value(child, "PLAC")
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
        pedi = child_value(child, "PEDI")
        if pedi and pedi.strip().lower() == "adopted":
            member["adopted"] = True

    return primary_name_done


def _parse_individuals(
    top_records: list[GedcomRecord],
) -> tuple[dict[str, str], list[GedcomMember]]:
    xref_to_member_id: dict[str, str] = {}  # "@I1@" → new uuid
    members: list[GedcomMember] = []

    for rec in top_records:
        if rec["tag"] != "INDI":
            continue
        xref = rec["xref"]
        if not xref:
            continue

        member = _new_member()
        xref_to_member_id[xref] = member["id"]

        primary_name_done = False
        for child in rec["children"]:
            primary_name_done = _apply_indi_child(
                member, child["tag"], child, primary_name_done
            )

        member["date_of_birth_sort"] = sort_key(member["date_of_birth"])
        member["date_of_death_sort"] = sort_key(member["date_of_death"])
        members.append(member)

    return xref_to_member_id, members


# ---------------------------------------------------------------------------
# Pass 2: FAM records
# ---------------------------------------------------------------------------

def _parse_families(
    top_records: list[GedcomRecord], xref_to_member_id: dict[str, str]
) -> list[GedcomRelation]:
    relations: list[GedcomRelation] = []
    seen_couple_pairs: set[frozenset] = set()
    seen_parent_pairs: set[tuple[str, str]] = set()

    for rec in top_records:
        if rec["tag"] != "FAM":
            continue

        husb_ids = [
            xref_to_member_id[x]
            for x in all_child_values(rec, "HUSB")
            if x in xref_to_member_id
        ]
        wife_ids = [
            xref_to_member_id[x]
            for x in all_child_values(rec, "WIFE")
            if x in xref_to_member_id
        ]
        chil_ids = [
            xref_to_member_id[x]
            for x in all_child_values(rec, "CHIL")
            if x in xref_to_member_id
        ]

        spouse_ids = husb_ids[:1] + wife_ids[:1]  # at most one each

        # Determine couple relation type.
        reltype_tag = child_value(rec, "_RELTYPE")
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

    return relations


# ---------------------------------------------------------------------------
# Pass 3: _REL records
# ---------------------------------------------------------------------------

def _parse_generic_relations(
    top_records: list[GedcomRecord],
    xref_to_member_id: dict[str, str],
    existing_relations: list[GedcomRelation],
) -> list[GedcomRelation]:
    new_relations: list[GedcomRelation] = []

    for rec in top_records:
        if rec["tag"] != "_REL":
            continue

        from_xref = child_value(rec, "_FROM")
        to_xref = child_value(rec, "_TO")
        rel_type = child_value(rec, "_TYPE")

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
        rel_entry: GedcomRelation = {
            "from_member_id": from_id,
            "to_member_id": to_id,
            "relation_type": rel_type.strip(),
        }
        if rel_entry not in existing_relations and rel_entry not in new_relations:
            new_relations.append(rel_entry)

    return new_relations
