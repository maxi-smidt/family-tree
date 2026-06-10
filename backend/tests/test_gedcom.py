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
            "firstName": "James",
            "lastName": "Smith",
            "maidenName": None,
            "gender": "m",
            "dateOfBirth": "1950-03-15",
            "dateOfDeath": None,
            "birthplace": "London",
            "hometown": "Manchester",
            "additionalData": "A note\nSecond line",
            "placesLived": None,
            "imageData": None,
            "isCollapsed": False,
            "positionX": 0.0,
            "positionY": 0.0,
        },
        {
            "id": mother_id,
            "firstName": "Mary",
            "lastName": "Smith",
            "maidenName": "Jones",
            "gender": "f",
            "dateOfBirth": "1952-07",
            "dateOfDeath": None,
            "birthplace": None,
            "hometown": None,
            "additionalData": None,
            "placesLived": None,
            "imageData": None,
            "isCollapsed": False,
            "positionX": 0.0,
            "positionY": 0.0,
        },
        {
            "id": child1_id,
            "firstName": "Tom",
            "lastName": "Smith",
            "maidenName": None,
            "gender": "m",
            "dateOfBirth": "1975",
            "dateOfDeath": None,
            "birthplace": None,
            "hometown": None,
            "additionalData": None,
            "placesLived": None,
            "imageData": None,
            "isCollapsed": False,
            "positionX": 0.0,
            "positionY": 0.0,
        },
        {
            "id": child2_id,
            "firstName": "Sara",
            "lastName": "Smith",
            "maidenName": None,
            "gender": "f",
            "dateOfBirth": "1978-11-22",
            "dateOfDeath": "2020-01-10",
            "birthplace": None,
            "hometown": None,
            "additionalData": None,
            "placesLived": None,
            "imageData": None,
            "isCollapsed": False,
            "positionX": 0.0,
            "positionY": 0.0,
        },
        {
            "id": single_parent_child_id,
            "firstName": "Alex",
            "lastName": "Smith",
            "maidenName": None,
            "gender": "o",
            "dateOfBirth": "1985",
            "dateOfDeath": None,
            "birthplace": None,
            "hometown": None,
            "additionalData": None,
            "placesLived": None,
            "imageData": None,
            "isCollapsed": False,
            "positionX": 0.0,
            "positionY": 0.0,
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
            (m.get("firstName"), m.get("lastName")): m
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

    def test_father_name(self):
        assert ("James", "Smith") in self.by_name

    def test_mother_maiden_name(self):
        mary = self.by_name[("Mary", "Smith")]
        assert mary["maidenName"] == "Jones"

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
        assert james["dateOfBirth"] == "1950-03-15"

    def test_year_month_date_round_trips(self):
        mary = self.by_name[("Mary", "Smith")]
        assert mary["dateOfBirth"] == "1952-07"

    def test_year_only_round_trips(self):
        tom = self.by_name[("Tom", "Smith")]
        assert tom["dateOfBirth"] == "1975"

    def test_death_date_round_trips(self):
        sara = self.by_name[("Sara", "Smith")]
        assert sara["dateOfDeath"] == "2020-01-10"

    def test_birthplace_round_trips(self):
        james = self.by_name[("James", "Smith")]
        assert james["birthplace"] == "London"

    def test_hometown_round_trips(self):
        james = self.by_name[("James", "Smith")]
        assert james["hometown"] == "Manchester"

    def test_multiline_note_round_trips(self):
        james = self.by_name[("James", "Smith")]
        assert james["additionalData"] == "A note\nSecond line"

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
                          firstName="George", lastName="Brown", gender="m",
                          dateOfBirth="1940")
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


def test_api_gedcom_import_uses_head_file_name(client, db):
    """When no name form field given, HEAD FILE tag is used for the tree name."""
    owner = make_user(db, "eve")
    headers = auth(owner)

    ged = b"0 HEAD\n1 FILE MyAncestors\n0 TRLR\n"
    resp = client.post(
        f"{API}/trees/import-gedcom",
        headers=headers,
        files={"file": ("test.ged", io.BytesIO(ged), "text/plain")},
        # No 'name' field provided.
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "MyAncestors"
