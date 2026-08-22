"""GEDCOM lexical parsing: raw text → flat tokens → a nested record tree."""

from __future__ import annotations

from app.services.bundle_types import GedcomRecord


def parse_lines(text: str) -> list[tuple[int, str | None, str, str]]:
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


def build_record_tree(
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
        child, idx = build_record_tree(parsed, idx, child_level)
        record["children"].append(child)
    return record, idx


def child_value(record: GedcomRecord, tag: str) -> str | None:
    """Return the first child's value that matches *tag*, or None."""
    for child in record.get("children", []):
        if child["tag"] == tag:
            return child["value"] or None
    return None


def all_child_values(record: GedcomRecord, tag: str) -> list[str]:
    """Return all child values matching *tag*."""
    return [c["value"] for c in record.get("children", []) if c["tag"] == tag]
