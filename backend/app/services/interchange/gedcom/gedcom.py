"""GEDCOM 5.5.1 (LINEAGE-LINKED) serializer and parser.

Operates entirely on plain dicts — no DB or SQLAlchemy imports. The actual
work is split across focused modules that this one re-exports as a stable
public API:

- ``gedcom_encoding`` — byte-level encoding detection (``decode_gedcom_bytes``)
- ``gedcom_dates``    — date string ↔ GEDCOM date conversion
- ``gedcom_records``  — lexical parsing: text → flat tokens → record tree
- ``gedcom_writer``   — ``serialize_to_gedcom``
- ``gedcom_reader``   — ``parse_gedcom``

Public API
----------
serialize_to_gedcom(tree_name, members, relations, documents=, document_files=,
                     citations=) -> str
parse_gedcom(text) -> {"members": [...], "relations": [...]}
"""

from __future__ import annotations

from app.services.interchange.gedcom.gedcom_encoding import decode_gedcom_bytes
from app.services.interchange.gedcom.gedcom_reader import parse_gedcom
from app.services.interchange.gedcom.gedcom_writer import serialize_to_gedcom

__all__ = ["serialize_to_gedcom", "parse_gedcom", "decode_gedcom_bytes"]
