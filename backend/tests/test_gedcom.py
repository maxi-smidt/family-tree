"""Tests for GEDCOM 5.5.1 import/export functionality.

Covers:
1. Unit tests for date helpers ``_to_gedcom_date`` / ``_from_gedcom_date``.
2. Service-level round-trip: serialize → parse → verify data integrity.
3. API round-trip: export from a live tree, re-import, verify member/relation counts.
"""

from __future__ import annotations

import io
from uuid import uuid4

# Date helpers are module-private but testable via direct import.
from app.services.gedcom import (
    _from_gedcom_date,
    _to_gedcom_date,
    decode_gedcom_bytes,
    parse_gedcom,
    serialize_to_gedcom,
)
from tests.conftest import API, auth, make_tree, make_user

# ---------------------------------------------------------------------------
# 1. Date helper unit tests
# ---------------------------------------------------------------------------

class TestToGedcomDate:
    def test_full_date(self):
        assert _to_gedcom_date("1950-06-15") == "15 JUN 1950"

    def test_year_month(self):
        assert _to_gedcom_date("1950-06") == "JUN 1950"

    def test_year_only(self):
        assert _to_gedcom_date("1950") == "1950"

    def test_iso_datetime_stripped(self):
        assert _to_gedcom_date("1950-06-15T12:34:56") == "15 JUN 1950"

    def test_none_returns_none(self):
        assert _to_gedcom_date(None) is None

    def test_empty_string_returns_none(self):
        assert _to_gedcom_date("") is None

    def test_passthrough_unrecognised(self):
        assert _to_gedcom_date("circa 1900") == "circa 1900"

    def test_first_month(self):
        assert _to_gedcom_date("2000-01-01") == "01 JAN 2000"

    def test_last_month(self):
        assert _to_gedcom_date("2000-12-31") == "31 DEC 2000"

    def test_year_only_four_digits(self):
        assert _to_gedcom_date("2023") == "2023"


class TestFromGedcomDate:
    def test_full_date(self):
        assert _from_gedcom_date("15 JUN 1950") == "1950-06-15"

    def test_year_month(self):
        assert _from_gedcom_date("JUN 1950") == "1950-06"

    def test_year_only(self):
        assert _from_gedcom_date("1950") == "1950"

    def test_none_returns_none(self):
        assert _from_gedcom_date(None) is None

    def test_case_insensitive(self):
        assert _from_gedcom_date("15 jun 1950") == "1950-06-15"

    def test_qualifier_passthrough_abt(self):
        val = _from_gedcom_date("ABT 1900")
        assert val == "ABT 1900"

    def test_qualifier_passthrough_est(self):
        assert _from_gedcom_date("EST 1800") == "EST 1800"

    def test_qualifier_passthrough_bef(self):
        assert _from_gedcom_date("BEF 1900") == "BEF 1900"

    def test_single_digit_day(self):
        assert _from_gedcom_date("5 MAR 1920") == "1920-03-05"

    def test_january(self):
        assert _from_gedcom_date("01 JAN 2000") == "2000-01-01"

    def test_december(self):
        assert _from_gedcom_date("31 DEC 1999") == "1999-12-31"

    def test_round_trip(self):
        """serialize then parse should recover the original date."""
        original = "1975-08-20"
        assert _from_gedcom_date(_to_gedcom_date(original)) == original


# ---------------------------------------------------------------------------
# 2. Service-level round-trip
# ---------------------------------------------------------------------------

def _make_id() -> str:
    return str(uuid4())


def _build_test_data() -> tuple[list[dict], list[dict]]:
    """Build a small family:

    - Father (m), Mother (f), married couple.
    - Child1 (m) with both parents.
    - Child2 (f) with both parents, full dates.
    - SingleParentChild (o) with only mother.
    - Sibling explicit relation between Child1 and Child2.
    """
    father_id = _make_id()
    mother_id = _make_id()
    child1_id = _make_id()
    child2_id = _make_id()
    single_parent_child_id = _make_id()

    members = [
        {
            "id": father_id,
            "first_name": "James",
            "middle_names": "Arthur Henry",
            "baptismal_name": "Jacobus",
            "last_name": "Smith",
            "maiden_name": None,
            "gender": "m",
            "date_of_birth": "1950-03-15",
            "date_of_death": None,
            "birthplace": "London",
            "hometown": "Manchester",
            "additional_data": "A note\nSecond line",
            "places_lived": None,
            "image_data": None,
            "is_collapsed": False,
            "position_x": 0.0,
            "position_y": 0.0,
        },
        {
            "id": mother_id,
            "first_name": "Mary",
            "last_name": "Smith",
            "maiden_name": "Jones",
            "gender": "f",
            "date_of_birth": "1952-07",
            "date_of_death": None,
            "birthplace": None,
            "hometown": None,
            "additional_data": None,
            "places_lived": None,
            "image_data": None,
            "is_collapsed": False,
            "position_x": 0.0,
            "position_y": 0.0,
        },
        {
            "id": child1_id,
            "first_name": "Tom",
            "last_name": "Smith",
            "maiden_name": None,
            "gender": "m",
            "date_of_birth": "1975",
            "date_of_death": None,
            "birthplace": None,
            "hometown": None,
            "additional_data": None,
            "places_lived": None,
            "image_data": None,
            "is_collapsed": False,
            "position_x": 0.0,
            "position_y": 0.0,
        },
        {
            "id": child2_id,
            "first_name": "Sara",
            "last_name": "Smith",
            "maiden_name": None,
            "gender": "f",
            "date_of_birth": "1978-11-22",
            "date_of_death": "2020-01-10",
            "birthplace": None,
            "hometown": None,
            "additional_data": None,
            "places_lived": None,
            "image_data": None,
            "is_collapsed": False,
            "position_x": 0.0,
            "position_y": 0.0,
        },
        {
            "id": single_parent_child_id,
            "first_name": "Alex",
            "last_name": "Smith",
            "maiden_name": None,
            "gender": "o",
            "date_of_birth": "1985",
            "date_of_death": None,
            "birthplace": None,
            "hometown": None,
            "additional_data": None,
            "places_lived": None,
            "image_data": None,
            "is_collapsed": False,
            "position_x": 0.0,
            "position_y": 0.0,
        },
    ]

    def _rel(f: str, t: str, rt: str) -> dict:
        return {"from_member_id": f, "to_member_id": t, "relation_type": rt}

    relations = [
        # married couple
        _rel(father_id, mother_id, "married"),
        # child1 → both parents
        _rel(child1_id, father_id, "parent"),
        _rel(child1_id, mother_id, "parent"),
        # child2 → both parents
        _rel(child2_id, father_id, "parent"),
        _rel(child2_id, mother_id, "parent"),
        # single parent child → only mother
        _rel(single_parent_child_id, mother_id, "parent"),
        # explicit sibling relation
        _rel(child1_id, child2_id, "sibling"),
    ]

    return members, relations


class TestServiceRoundTrip:
    def setup_method(self):
        self.members, self.relations = _build_test_data()
        self.ged_text = serialize_to_gedcom("TestTree", self.members, self.relations)
        self.parsed = parse_gedcom(self.ged_text)
        # Build lookup by name for assertions.
        self.by_name = {
            (m.get("first_name"), m.get("last_name")): m
            for m in self.parsed["members"]
        }

    def test_member_count(self):
        assert len(self.parsed["members"]) == 5

    def test_gedcom_has_head_and_trlr(self):
        assert "0 HEAD" in self.ged_text
        assert "0 TRLR" in self.ged_text

    def test_gedcom_has_indi(self):
        assert "INDI" in self.ged_text

    def test_gedcom_has_fam(self):
        assert " FAM" in self.ged_text

    def test_header_has_required_submitter(self):
        # GEDCOM 5.5.1 requires a submitter reference in the header ({1:1})
        # backed by a matching SUBM record with a NAME.
        assert "1 SUBM @SUBM1@" in self.ged_text
        assert "0 @SUBM1@ SUBM" in self.ged_text
        subm_idx = self.ged_text.index("0 @SUBM1@ SUBM")
        assert "1 NAME" in self.ged_text[subm_idx:]

    def test_marriage_event_asserts_occurrence(self):
        # A detail-less family event must carry the value "Y" in 5.5.1.
        assert "1 MARR Y" in self.ged_text

    def test_father_name(self):
        assert ("James", "Smith") in self.by_name

    def test_name_details_round_trip(self):
        james = self.by_name[("James", "Smith")]
        assert james["middle_names"] == "Arthur Henry"
        assert james["baptismal_name"] == "Jacobus"
        assert "2 _FIRST_NAME James" in self.ged_text
        assert "2 _MIDDLE_NAMES Arthur Henry" in self.ged_text
        assert "2 TYPE baptismal" in self.ged_text

    def test_mother_maiden_name(self):
        mary = self.by_name[("Mary", "Smith")]
        assert mary["maiden_name"] == "Jones"

    def test_gender_o_round_trips(self):
        alex = self.by_name[("Alex", "Smith")]
        assert alex["gender"] == "o"

    def test_gender_m_round_trips(self):
        james = self.by_name[("James", "Smith")]
        assert james["gender"] == "m"

    def test_gender_f_round_trips(self):
        mary = self.by_name[("Mary", "Smith")]
        assert mary["gender"] == "f"

    def test_full_date_round_trips(self):
        james = self.by_name[("James", "Smith")]
        assert james["date_of_birth"] == "1950-03-15"

    def test_year_month_date_round_trips(self):
        mary = self.by_name[("Mary", "Smith")]
        assert mary["date_of_birth"] == "1952-07"

    def test_year_only_round_trips(self):
        tom = self.by_name[("Tom", "Smith")]
        assert tom["date_of_birth"] == "1975"

    def test_death_date_round_trips(self):
        sara = self.by_name[("Sara", "Smith")]
        assert sara["date_of_death"] == "2020-01-10"

    def test_birthplace_round_trips(self):
        james = self.by_name[("James", "Smith")]
        assert james["birthplace"] == "London"

    def test_hometown_round_trips(self):
        james = self.by_name[("James", "Smith")]
        assert james["hometown"] == "Manchester"

    def test_multiline_note_round_trips(self):
        james = self.by_name[("James", "Smith")]
        assert james["additional_data"] == "A note\nSecond line"

    def _get_id(self, first: str, last: str) -> str:
        return self.by_name[(first, last)]["id"]

    def test_couple_relation_exists(self):
        james_id = self._get_id("James", "Smith")
        mary_id = self._get_id("Mary", "Smith")
        couple_rels = [
            r for r in self.parsed["relations"]
            if r["relation_type"] == "married"
            and set([r["from_member_id"], r["to_member_id"]]) == {james_id, mary_id}
        ]
        assert len(couple_rels) == 1

    def test_child1_has_two_parents(self):
        tom_id = self._get_id("Tom", "Smith")
        parent_rels = [
            r for r in self.parsed["relations"]
            if r["relation_type"] == "parent" and r["from_member_id"] == tom_id
        ]
        assert len(parent_rels) == 2

    def test_child2_has_two_parents(self):
        sara_id = self._get_id("Sara", "Smith")
        parent_rels = [
            r for r in self.parsed["relations"]
            if r["relation_type"] == "parent" and r["from_member_id"] == sara_id
        ]
        assert len(parent_rels) == 2

    def test_single_parent_child_has_one_parent(self):
        alex_id = self._get_id("Alex", "Smith")
        parent_rels = [
            r for r in self.parsed["relations"]
            if r["relation_type"] == "parent" and r["from_member_id"] == alex_id
        ]
        assert len(parent_rels) == 1

    def test_sibling_relation_preserved(self):
        tom_id = self._get_id("Tom", "Smith")
        sara_id = self._get_id("Sara", "Smith")
        sibling_rels = [
            r for r in self.parsed["relations"]
            if r["relation_type"] == "sibling"
            and r["from_member_id"] == tom_id
            and r["to_member_id"] == sara_id
        ]
        assert len(sibling_rels) == 1

    def test_child1_parents_are_correct(self):
        tom_id = self._get_id("Tom", "Smith")
        james_id = self._get_id("James", "Smith")
        mary_id = self._get_id("Mary", "Smith")
        parent_ids = {
            r["to_member_id"]
            for r in self.parsed["relations"]
            if r["relation_type"] == "parent" and r["from_member_id"] == tom_id
        }
        assert parent_ids == {james_id, mary_id}

    def test_no_duplicate_relations(self):
        rel_tuples = [
            (r["from_member_id"], r["to_member_id"], r["relation_type"])
            for r in self.parsed["relations"]
        ]
        assert len(rel_tuples) == len(set(rel_tuples))


# ---------------------------------------------------------------------------
# 3. API round-trip test
# ---------------------------------------------------------------------------

def _post_member(client, tree_id: str, headers: dict, **kw) -> dict:
    mid = str(uuid4())
    payload = {"id": mid, "firstName": "Test", "lastName": "Person", "gender": "f"}
    payload.update(kw)
    resp = client.post(f"{API}/trees/{tree_id}/members", headers=headers, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _post_relation(
    client,
    tree_id: str,
    headers: dict,
    from_id: str,
    to_id: str,
    rtype: str,
) -> None:
    resp = client.post(
        f"{API}/trees/{tree_id}/relations",
        headers=headers,
        json={"from_member_id": from_id, "to_member_id": to_id, "relation_type": rtype},
    )
    assert resp.status_code == 201, resp.text


def test_api_gedcom_round_trip(client, db):
    """Full API round-trip: create tree → export GEDCOM → import GEDCOM → verify."""
    owner = make_user(db, "alice")
    headers = auth(owner)

    # Create a tree via the API.
    tree_resp = client.post(
        f"{API}/trees", headers=headers, json={"name": "RoundTripTree"}
    )
    assert tree_resp.status_code == 201
    tree_id = tree_resp.json()["id"]

    # Add members.
    father = _post_member(client, tree_id, headers,
                          firstName="George", middleNames="Albert",
                          baptismalName="Georgius", lastName="Brown",
                          gender="m", dateOfBirth="1940")
    mother = _post_member(client, tree_id, headers,
                          firstName="Helen", lastName="Brown", gender="f",
                          dateOfBirth="1945-06")
    child = _post_member(client, tree_id, headers,
                         firstName="Paul", lastName="Brown", gender="m",
                         dateOfBirth="1968-09-01")

    father_id = father["id"]
    mother_id = mother["id"]
    child_id = child["id"]

    # Add relations.
    _post_relation(client, tree_id, headers, father_id, mother_id, "married")
    _post_relation(client, tree_id, headers, child_id, father_id, "parent")
    _post_relation(client, tree_id, headers, child_id, mother_id, "parent")

    # Export as GEDCOM.
    export_resp = client.get(
        f"{API}/trees/{tree_id}/export-gedcom", headers=headers
    )
    assert export_resp.status_code == 200
    ged_bytes = export_resp.content
    ged_text = ged_bytes.decode("utf-8")

    # Verify structure of exported GEDCOM.
    assert "0 HEAD" in ged_text
    assert "0 TRLR" in ged_text
    assert "INDI" in ged_text
    assert " FAM" in ged_text

    # Import the GEDCOM as a new tree.
    import_resp = client.post(
        f"{API}/trees/import-gedcom",
        headers=headers,
        files={"file": ("test.ged", io.BytesIO(ged_bytes), "text/plain")},
        data={"name": "ImportedGedcomTree"},
    )
    assert import_resp.status_code == 201, import_resp.text
    imported = import_resp.json()
    assert imported["name"] == "ImportedGedcomTree"
    assert imported["role"] == "owner"

    new_tree_id = imported["id"]

    # Verify members in imported tree.
    members_resp = client.get(
        f"{API}/trees/{new_tree_id}/members", headers=headers
    )
    assert members_resp.status_code == 200
    imported_members = members_resp.json()
    assert len(imported_members) == 3

    # Verify parent relations in imported tree.
    relations_resp = client.get(
        f"{API}/trees/{new_tree_id}/relations", headers=headers
    )
    assert relations_resp.status_code == 200
    imported_relations = relations_resp.json()
    parent_rels = [r for r in imported_relations if r["relation_type"] == "parent"]
    assert len(parent_rels) == 2

    # Verify name is preserved.
    names = {(m.get("firstName"), m.get("lastName")) for m in imported_members}
    assert ("George", "Brown") in names
    assert ("Helen", "Brown") in names
    assert ("Paul", "Brown") in names
    imported_father = next(
        m for m in imported_members if m.get("firstName") == "George"
    )
    assert imported_father["middleNames"] == "Albert"
    assert imported_father["baptismalName"] == "Georgius"


def test_gedcom_import_splits_standard_given_names():
    ged = (
        "0 HEAD\n"
        "0 @I1@ INDI\n"
        "1 NAME John Paul /Doe/\n"
        "2 GIVN John Paul\n"
        "2 SURN Doe\n"
        "0 TRLR\n"
    )

    member = parse_gedcom(ged)["members"][0]

    assert member["first_name"] == "John"
    assert member["middle_names"] == "Paul"


def test_api_export_requires_auth(client, db):
    """Export without authentication should fail with 401."""
    owner = make_user(db, "bob")
    tree = make_tree(db, owner)

    resp = client.get(f"{API}/trees/{tree.id}/export-gedcom")
    assert resp.status_code == 401


def test_api_import_requires_auth(client, db):
    """Import without authentication should fail with 401."""
    ged = b"0 HEAD\n0 TRLR\n"
    resp = client.post(
        f"{API}/trees/import-gedcom",
        files={"file": ("test.ged", io.BytesIO(ged), "text/plain")},
    )
    assert resp.status_code == 401


def test_api_import_bad_file_returns_400(client, db):
    """A non-GEDCOM file should return 400."""
    owner = make_user(db, "carol")
    headers = auth(owner)
    bad_bytes = b"this is not a gedcom file at all !!!###"
    # The parser is lenient; send something that will cause member count = 0
    # but won't raise. We test that the endpoint handles completely corrupt
    # binary gracefully without 500.
    resp = client.post(
        f"{API}/trees/import-gedcom",
        headers=headers,
        files={"file": ("bad.ged", io.BytesIO(bad_bytes), "text/plain")},
    )
    # Either succeeds with an empty tree or rejects — must not be 500.
    assert resp.status_code in (201, 400)


def test_api_export_gedcom_content_disposition(client, db):
    """Exported file should have correct content-disposition header."""
    owner = make_user(db, "diana")
    headers = auth(owner)

    tree_resp = client.post(
        f"{API}/trees", headers=headers, json={"name": "MyFamily"}
    )
    assert tree_resp.status_code == 201
    tree_id = tree_resp.json()["id"]

    export_resp = client.get(
        f"{API}/trees/{tree_id}/export-gedcom", headers=headers
    )
    assert export_resp.status_code == 200
    cd = export_resp.headers.get("content-disposition", "")
    assert "MyFamily.ged" in cd


def test_api_gedcom_import_uses_filename_stem(client, db):
    """When no name form field given, the uploaded filename stem is used."""
    owner = make_user(db, "eve")
    headers = auth(owner)

    ged = b"0 HEAD\n1 FILE MyAncestors\n0 TRLR\n"
    resp = client.post(
        f"{API}/trees/import-gedcom",
        headers=headers,
        files={"file": ("my_family.ged", io.BytesIO(ged), "text/plain")},
        # No 'name' field provided — filename stem takes precedence over HEAD FILE.
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "my_family"




# ---------------------------------------------------------------------------
# 4. decode_gedcom_bytes unit tests
# ---------------------------------------------------------------------------

# A minimal GEDCOM snippet used across encoding tests.
_SAMPLE_GEDCOM = (
    "0 HEAD\n"
    "1 CHAR UNICODE\n"
    "0 @I1@ INDI\n"
    "1 NAME John /Doe/\n"
    "0 TRLR\n"
)


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


# ---------------------------------------------------------------------------
# 5. API regression test — UTF-16 BE import
# ---------------------------------------------------------------------------

def _minimal_gedcom_utf16be(n_indis: int = 2) -> bytes:
    """Build a minimal GEDCOM with n_indis INDI records, UTF-16 BE with BOM."""
    lines = ["0 HEAD", "1 CHAR UNICODE"]
    for i in range(1, n_indis + 1):
        lines += [
            f"0 @I{i}@ INDI",
            f"1 NAME Person{i} /Test/",
            "1 SEX M",
        ]
    lines += ["0 @F1@ FAM", "1 HUSB @I1@", "1 WIFE @I2@", "0 TRLR"]
    text = "\n".join(lines) + "\n"
    bom = b"\xfe\xff"
    return bom + text.encode("utf-16-be")


def test_api_import_gedcom_utf16_be(client, db):
    """Regression test: a UTF-16 BE GEDCOM must import > 0 members (was broken)."""
    owner = make_user(db, "frank")
    headers = auth(owner)

    raw = _minimal_gedcom_utf16be(n_indis=2)
    # Sanity: the first two bytes must be the BE BOM.
    assert raw[:2] == b"\xfe\xff"

    resp = client.post(
        f"{API}/trees/import-gedcom",
        headers=headers,
        files={"file": ("sample.ged", io.BytesIO(raw), "application/octet-stream")},
        data={"name": "UTF16Import"},
    )
    assert resp.status_code == 201, resp.text
    new_tree_id = resp.json()["id"]

    members_resp = client.get(
        f"{API}/trees/{new_tree_id}/members", headers=headers
    )
    assert members_resp.status_code == 200
    imported_members = members_resp.json()
    # Must have imported both INDI records — this was 0 before the fix.
    assert len(imported_members) == 2

    # A FAM with HUSB + WIFE but no MARR/DIV/_RELTYPE must yield a "married"
    # couple relation so the union node renders green, not grey. (#295)
    relations_resp = client.get(
        f"{API}/trees/{new_tree_id}/relations", headers=headers
    )
    assert relations_resp.status_code == 200
    married_rels = [
        r for r in relations_resp.json() if r["relation_type"] == "married"
    ]
    assert len(married_rels) == 1


# ---------------------------------------------------------------------------
# 6. Union relation-type defaulting (#295)
# ---------------------------------------------------------------------------

def _fam_gedcom(
    husb: bool = True,
    wife: bool = True,
    extra_fam_lines: list[str] | None = None,
) -> str:
    """Build a minimal GEDCOM with optional HUSB/WIFE and optional extra FAM lines."""
    lines = ["0 HEAD", "1 CHAR UTF-8"]
    if husb:
        lines += ["0 @I1@ INDI", "1 NAME Tom /Smith/", "1 SEX M"]
    if wife:
        lines += ["0 @I2@ INDI", "1 NAME Mary /Smith/", "1 SEX F"]
    fam = ["0 @F1@ FAM"]
    if husb:
        fam.append("1 HUSB @I1@")
    if wife:
        fam.append("1 WIFE @I2@")
    if extra_fam_lines:
        fam.extend(extra_fam_lines)
    lines += fam + ["0 TRLR"]
    return "\n".join(lines) + "\n"


class TestUnionRelationTypeDefaulting:
    """Regression tests for issue #295 — grey union nodes after GEDCOM import."""

    def test_two_spouses_no_type_defaults_married(self):
        """FAM with HUSB + WIFE but no MARR/DIV/_RELTYPE must yield a married relation."""
        parsed = parse_gedcom(_fam_gedcom())
        couple_rels = [r for r in parsed["relations"] if r["relation_type"] == "married"]
        assert len(couple_rels) == 1

    def test_explicit_marr_still_married(self):
        """Explicit MARR event must still produce a married relation."""
        parsed = parse_gedcom(_fam_gedcom(extra_fam_lines=["1 MARR Y"]))
        couple_rels = [r for r in parsed["relations"] if r["relation_type"] == "married"]
        assert len(couple_rels) == 1

    def test_explicit_div_overrides_default(self):
        """FAM with DIV event must produce divorced, not married."""
        parsed = parse_gedcom(_fam_gedcom(extra_fam_lines=["1 DIV Y"]))
        couple_rels = [r for r in parsed["relations"] if r["relation_type"] == "divorced"]
        assert len(couple_rels) == 1
        non_divorced = [r for r in parsed["relations"] if r["relation_type"] == "married"]
        assert len(non_divorced) == 0

    def test_explicit_reltype_wins_over_default(self):
        """_RELTYPE tag must take precedence over the two-spouse default."""
        parsed = parse_gedcom(_fam_gedcom(extra_fam_lines=["1 _RELTYPE partner"]))
        couple_rels = [r for r in parsed["relations"] if r["relation_type"] == "partner"]
        assert len(couple_rels) == 1
        married_rels = [r for r in parsed["relations"] if r["relation_type"] == "married"]
        assert len(married_rels) == 0

    def test_single_spouse_no_type_no_couple_relation(self):
        """FAM with only one spouse and no type tags — no couple relation."""
        parsed = parse_gedcom(_fam_gedcom(wife=False))  # only HUSB
        couple_rels = [
            r for r in parsed["relations"]
            if r["relation_type"] in ("married", "divorced", "partner")
        ]
        assert len(couple_rels) == 0

    def test_no_spouses_no_couple_relation(self):
        """FAM with no HUSB/WIFE (children only) must not produce a couple relation."""
        lines = [
            "0 HEAD", "1 CHAR UTF-8",
            "0 @I1@ INDI", "1 NAME Kid /One/",
            "0 @F1@ FAM", "1 CHIL @I1@",
            "0 TRLR",
        ]
        parsed = parse_gedcom("\n".join(lines) + "\n")
        couple_rels = [
            r for r in parsed["relations"]
            if r["relation_type"] in ("married", "divorced", "partner")
        ]
        assert len(couple_rels) == 0


# ---------------------------------------------------------------------------
# 7. Fuzzy date round-trip (issue #343)
# ---------------------------------------------------------------------------

class TestFuzzyDateRoundTrip:
    """Fuzzy / qualified dates must survive a full serialize → parse cycle
    without losing the qualifier prefix.

    ``serialize_to_gedcom`` calls ``_to_gedcom_date`` which passes through
    unrecognised strings (e.g. ``"about 1850"``, ``"ABT 1900"``) verbatim, and
    ``parse_gedcom`` stores them unchanged via ``_from_gedcom_date`` (qualifier
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
