"""Unit tests for ``app.services.interchange.gedcom.genealogy_date``.

Covers:
1. ISO date sort-key derivation (full / year-month / year-only).
2. GEDCOM-style date sort-key derivation (DD MON YYYY / MON YYYY).
3. Qualifier detection for all supported keywords.
4. Year extraction from fuzzy / qualified strings.
5. Edge cases: None input, empty string, unrecognisable garbage.
"""

from __future__ import annotations

from app.services.interchange.gedcom.genealogy_date import (
    QUALIFIER_ABOUT,
    QUALIFIER_AFTER,
    QUALIFIER_BEFORE,
    QUALIFIER_BETWEEN,
    QUALIFIER_ESTIMATED,
    QUALIFIER_EXACT,
    GenealogyDate,
    parse_genealogy_date,
    sort_key,
)

# ---------------------------------------------------------------------------
# 1. ISO date sort-key derivation
# ---------------------------------------------------------------------------


class TestIsoSortKey:
    def test_full_iso_date(self):
        assert sort_key("1950-06-15") == "1950-06-15"

    def test_iso_year_month(self):
        assert sort_key("1950-06") == "1950-06-00"

    def test_iso_year_only(self):
        assert sort_key("1950") == "1950-00-00"

    def test_iso_datetime_strips_time(self):
        assert sort_key("1950-06-15T12:34:56") == "1950-06-15"

    def test_earliest_valid_year(self):
        assert sort_key("0001-01-01") == "0001-01-01"

    def test_full_date_zero_padded(self):
        assert sort_key("2000-01-05") == "2000-01-05"

    def test_year_month_december(self):
        assert sort_key("2023-12") == "2023-12-00"


# ---------------------------------------------------------------------------
# 2. GEDCOM-style date sort-key derivation
# ---------------------------------------------------------------------------


class TestGedcomSortKey:
    def test_dd_mon_yyyy(self):
        assert sort_key("15 JUN 1950") == "1950-06-15"

    def test_dd_mon_yyyy_lowercase(self):
        assert sort_key("15 jun 1950") == "1950-06-15"

    def test_mon_yyyy(self):
        assert sort_key("JUN 1950") == "1950-06-00"

    def test_mon_yyyy_lowercase(self):
        assert sort_key("jun 1950") == "1950-06-00"

    def test_first_month_jan(self):
        assert sort_key("01 JAN 2000") == "2000-01-01"

    def test_last_month_dec(self):
        assert sort_key("31 DEC 2000") == "2000-12-31"

    def test_single_digit_day(self):
        assert sort_key("5 MAR 1980") == "1980-03-05"


# ---------------------------------------------------------------------------
# 3. Qualifier detection
# ---------------------------------------------------------------------------


class TestQualifierDetection:
    def test_exact_plain_iso(self):
        gd = parse_genealogy_date("1950-06-15")
        assert gd.qualifier == QUALIFIER_EXACT

    def test_exact_year_only(self):
        gd = parse_genealogy_date("1900")
        assert gd.qualifier == QUALIFIER_EXACT

    # about
    def test_about_keyword(self):
        assert parse_genealogy_date("about 1850").qualifier == QUALIFIER_ABOUT

    def test_abt_keyword(self):
        assert parse_genealogy_date("ABT 1850").qualifier == QUALIFIER_ABOUT

    def test_abt_lowercase(self):
        assert parse_genealogy_date("abt 1850").qualifier == QUALIFIER_ABOUT

    def test_circa_keyword(self):
        assert parse_genealogy_date("circa 1850").qualifier == QUALIFIER_ABOUT

    def test_ca_keyword(self):
        assert parse_genealogy_date("ca 1850").qualifier == QUALIFIER_ABOUT

    def test_ca_dot_keyword(self):
        assert parse_genealogy_date("ca. 1850").qualifier == QUALIFIER_ABOUT

    def test_c_dot_keyword(self):
        assert parse_genealogy_date("c. 1850").qualifier == QUALIFIER_ABOUT

    def test_tilde_symbol(self):
        assert parse_genealogy_date("~1850").qualifier == QUALIFIER_ABOUT

    # before
    def test_before_keyword(self):
        assert parse_genealogy_date("before 1900").qualifier == QUALIFIER_BEFORE

    def test_bef_keyword(self):
        assert parse_genealogy_date("BEF 1900").qualifier == QUALIFIER_BEFORE

    def test_lt_symbol(self):
        assert parse_genealogy_date("< 1900").qualifier == QUALIFIER_BEFORE

    # after
    def test_after_keyword(self):
        assert parse_genealogy_date("after 1900").qualifier == QUALIFIER_AFTER

    def test_aft_keyword(self):
        assert parse_genealogy_date("AFT 1900").qualifier == QUALIFIER_AFTER

    def test_gt_symbol(self):
        assert parse_genealogy_date("> 1900").qualifier == QUALIFIER_AFTER

    # between
    def test_between_keyword(self):
        gd = parse_genealogy_date("between 1850 and 1860")
        assert gd.qualifier == QUALIFIER_BETWEEN

    def test_bet_keyword(self):
        assert parse_genealogy_date("BET 1850 AND 1860").qualifier == QUALIFIER_BETWEEN

    def test_implicit_or(self):
        assert parse_genealogy_date("1850 or 1851").qualifier == QUALIFIER_BETWEEN

    def test_implicit_and(self):
        assert parse_genealogy_date("1850 and 1851").qualifier == QUALIFIER_BETWEEN

    # estimated
    def test_estimated_keyword(self):
        assert parse_genealogy_date("estimated 1880").qualifier == QUALIFIER_ESTIMATED

    def test_est_keyword(self):
        assert parse_genealogy_date("EST 1880").qualifier == QUALIFIER_ESTIMATED

    def test_calculated_keyword(self):
        assert parse_genealogy_date("calculated 1880").qualifier == QUALIFIER_ESTIMATED

    def test_cal_keyword(self):
        assert parse_genealogy_date("CAL 1880").qualifier == QUALIFIER_ESTIMATED


# ---------------------------------------------------------------------------
# 4. Year extraction from fuzzy / qualified strings
# ---------------------------------------------------------------------------


class TestFuzzyYearExtraction:
    def test_about_gives_year_sort_key(self):
        assert sort_key("about 1850") == "1850-00-00"

    def test_abt_gedcom_gives_year_sort_key(self):
        assert sort_key("ABT 1850") == "1850-00-00"

    def test_before_gives_year_sort_key(self):
        assert sort_key("before 1900") == "1900-00-00"

    def test_after_gives_year_sort_key(self):
        assert sort_key("after 1800") == "1800-00-00"

    def test_between_takes_first_year(self):
        # Lower bound (first year) is used as sort key.
        assert sort_key("between 1850 and 1860") == "1850-00-00"

    def test_estimated_gives_year_sort_key(self):
        assert sort_key("estimated 1880") == "1880-00-00"

    def test_circa_gives_year_sort_key(self):
        assert sort_key("circa 1920") == "1920-00-00"


# ---------------------------------------------------------------------------
# 5. Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_none_returns_none(self):
        assert sort_key(None) is None

    def test_empty_string_returns_none(self):
        assert sort_key("") is None

    def test_whitespace_only_returns_none(self):
        assert sort_key("   ") is None

    def test_garbage_no_year_returns_none(self):
        assert sort_key("unknown") is None

    def test_text_with_no_four_digit_year_returns_none(self):
        assert sort_key("no date here 123") is None

    def test_original_preserved(self):
        gd = parse_genealogy_date("ABT 1850")
        assert gd.original == "ABT 1850"

    def test_none_original_preserved(self):
        gd = parse_genealogy_date(None)
        assert gd.original == ""
        assert gd.sort_key is None

    def test_returns_genealogy_date_instance(self):
        result = parse_genealogy_date("1900")
        assert isinstance(result, GenealogyDate)
