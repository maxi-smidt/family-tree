"""Unit tests for GEDCOM byte-encoding detection
(``app.services.interchange.gedcom.gedcom_encoding``)."""

from __future__ import annotations

from app.services.interchange.gedcom.gedcom import parse_gedcom
from app.services.interchange.gedcom.gedcom_encoding import decode_gedcom_bytes

# A minimal GEDCOM snippet used across encoding tests.
_SAMPLE_GEDCOM = "0 HEAD\n1 CHAR UNICODE\n0 @I1@ INDI\n1 NAME John /Doe/\n0 TRLR\n"


class TestDecodeGedcomBytes:
    """decode_gedcom_bytes must recover the original text for each encoding."""

    def _assert_decoded(self, raw: bytes) -> None:
        result = decode_gedcom_bytes(raw)
        assert "0 HEAD" in result
        assert "John /Doe/" in result

    def test_utf8_no_bom(self):
        raw = _SAMPLE_GEDCOM.encode("utf-8")
        self._assert_decoded(raw)

    def test_utf8_with_bom(self):
        raw = _SAMPLE_GEDCOM.encode("utf-8-sig")
        assert raw[:3] == b"\xef\xbb\xbf"
        self._assert_decoded(raw)

    def test_utf16_le_with_bom(self):
        # Python's "utf-16" codec writes a LE BOM on most platforms; we build
        # the bytes explicitly to guarantee LE+BOM regardless of platform.
        bom = b"\xff\xfe"
        raw = bom + _SAMPLE_GEDCOM.encode("utf-16-le")
        self._assert_decoded(raw)

    def test_utf16_be_with_bom(self):
        bom = b"\xfe\xff"
        raw = bom + _SAMPLE_GEDCOM.encode("utf-16-be")
        self._assert_decoded(raw)

    def test_utf16_stdlib_encode(self):
        # Python's str.encode("utf-16") writes a BOM automatically.
        raw = _SAMPLE_GEDCOM.encode("utf-16")
        self._assert_decoded(raw)

    def test_latin1_fallback(self):
        # Latin-1 text with no BOM and no NUL bytes.
        latin_gedcom = "0 HEAD\n0 @I1@ INDI\n1 NAME Jos\xe9 /Garc\xeda/\n0 TRLR\n"
        raw = latin_gedcom.encode("latin-1")
        result = decode_gedcom_bytes(raw)
        assert "0 HEAD" in result

    def test_parse_after_decode_utf16_be(self):
        """parse_gedcom should find the INDI record after UTF-16-BE decoding."""
        bom = b"\xfe\xff"
        raw = bom + _SAMPLE_GEDCOM.encode("utf-16-be")
        text = decode_gedcom_bytes(raw)
        parsed = parse_gedcom(text)
        assert len(parsed["members"]) == 1
        assert parsed["members"][0]["first_name"] == "John"
        assert parsed["members"][0]["last_name"] == "Doe"

    def test_parse_after_decode_utf16_le(self):
        """parse_gedcom should find the INDI record after UTF-16-LE decoding."""
        bom = b"\xff\xfe"
        raw = bom + _SAMPLE_GEDCOM.encode("utf-16-le")
        text = decode_gedcom_bytes(raw)
        parsed = parse_gedcom(text)
        assert len(parsed["members"]) == 1
