"""Byte-level encoding detection for GEDCOM file uploads."""

from __future__ import annotations


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
