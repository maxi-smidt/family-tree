"""Unit tests for GEDCOM date conversion
(``app.services.interchange.gedcom.gedcom_dates``)."""

from __future__ import annotations

from uuid import uuid4

from app.services.interchange.gedcom.gedcom import parse_gedcom, serialize_to_gedcom
from app.services.interchange.gedcom.gedcom_dates import from_gedcom_date, to_gedcom_date


class TestToGedcomDate:
    def test_full_date(self):
        assert to_gedcom_date("1950-06-15") == "15 JUN 1950"

    def test_year_month(self):
        assert to_gedcom_date("1950-06") == "JUN 1950"

    def test_year_only(self):
        assert to_gedcom_date("1950") == "1950"

    def test_iso_datetime_stripped(self):
        assert to_gedcom_date("1950-06-15T12:34:56") == "15 JUN 1950"

    def test_none_returns_none(self):
        assert to_gedcom_date(None) is None

    def test_empty_string_returns_none(self):
        assert to_gedcom_date("") is None

    def test_passthrough_unrecognised(self):
        assert to_gedcom_date("circa 1900") == "circa 1900"

    def test_first_month(self):
        assert to_gedcom_date("2000-01-01") == "01 JAN 2000"

    def test_last_month(self):
        assert to_gedcom_date("2000-12-31") == "31 DEC 2000"

    def test_year_only_four_digits(self):
        assert to_gedcom_date("2023") == "2023"


class TestFromGedcomDate:
    def test_full_date(self):
        assert from_gedcom_date("15 JUN 1950") == "1950-06-15"

    def test_year_month(self):
        assert from_gedcom_date("JUN 1950") == "1950-06"

    def test_year_only(self):
        assert from_gedcom_date("1950") == "1950"

    def test_none_returns_none(self):
        assert from_gedcom_date(None) is None

    def test_case_insensitive(self):
        assert from_gedcom_date("15 jun 1950") == "1950-06-15"

    def test_qualifier_passthrough_abt(self):
        val = from_gedcom_date("ABT 1900")
        assert val == "ABT 1900"

    def test_qualifier_passthrough_est(self):
        assert from_gedcom_date("EST 1800") == "EST 1800"

    def test_qualifier_passthrough_bef(self):
        assert from_gedcom_date("BEF 1900") == "BEF 1900"

    def test_single_digit_day(self):
        assert from_gedcom_date("5 MAR 1920") == "1920-03-05"

    def test_january(self):
        assert from_gedcom_date("01 JAN 2000") == "2000-01-01"

    def test_december(self):
        assert from_gedcom_date("31 DEC 1999") == "1999-12-31"

    def test_round_trip(self):
        """serialize then parse should recover the original date."""
        original = "1975-08-20"
        assert from_gedcom_date(to_gedcom_date(original)) == original


# ---------------------------------------------------------------------------
# Fuzzy date round-trip through the full serialize/parse pipeline (#343)
# ---------------------------------------------------------------------------

class TestFuzzyDateRoundTrip:
    """Fuzzy / qualified dates must survive a full serialize → parse cycle
    without losing the qualifier prefix.

    ``serialize_to_gedcom`` calls ``to_gedcom_date`` which passes through
    unrecognised strings (e.g. ``"about 1850"``, ``"ABT 1900"``) verbatim, and
    ``parse_gedcom`` stores them unchanged via ``from_gedcom_date`` (qualifier
    passthrough).  The member that comes out of ``parse_gedcom`` must have the
    same date string as the one that went in.
    """

    def _round_trip(self, date_value: str) -> str | None:
        """Round-trip *date_value* through serialize → parse and return result."""
        member = {
            "id": str(uuid4()),
            "first_name": "Test",
            "last_name": "Person",
            "gender": "m",
            "date_of_birth": date_value,
            "date_of_death": None,
            "birthplace": None,
            "hometown": None,
            "additional_data": None,
            "places_lived": None,
            "image_data": None,
        }
        gedcom_text = serialize_to_gedcom("TestTree", [member], [])
        result = parse_gedcom(gedcom_text)
        imported = result["members"]
        assert len(imported) == 1
        return imported[0].get("date_of_birth")

    def test_fuzzy_about_survives_round_trip(self):
        """``"about 1850"`` must come back as ``"about 1850"``."""
        assert self._round_trip("about 1850") == "about 1850"

    def test_abt_qualifier_survives_round_trip(self):
        """GEDCOM ``"ABT 1900"`` must come back as ``"ABT 1900"``."""
        assert self._round_trip("ABT 1900") == "ABT 1900"

    def test_bef_qualifier_survives_round_trip(self):
        """GEDCOM ``"BEF 1850"`` must come back as ``"BEF 1850"``."""
        assert self._round_trip("BEF 1850") == "BEF 1850"

    def test_aft_qualifier_survives_round_trip(self):
        """GEDCOM ``"AFT 1800"`` must come back as ``"AFT 1800"``."""
        assert self._round_trip("AFT 1800") == "AFT 1800"

    def test_est_qualifier_survives_round_trip(self):
        """GEDCOM ``"EST 1880"`` must come back as ``"EST 1880"``."""
        assert self._round_trip("EST 1880") == "EST 1880"

    def test_exact_iso_date_still_converts(self):
        """An exact ISO date must still convert to GEDCOM and back correctly."""
        assert self._round_trip("1975-08-20") == "1975-08-20"
