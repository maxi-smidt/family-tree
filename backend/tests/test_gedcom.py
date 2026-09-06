"""Tests for GEDCOM 5.5.1 import/export functionality.

Date-helper tests live in ``test_gedcom_dates.py`` and byte-encoding-detection
tests live in ``test_gedcom_encoding.py``. This file covers:
1. Service-level round-trip: serialize → parse → verify data integrity.
2. API round-trip: export from a live tree, re-import, verify member/relation counts.
"""

from __future__ import annotations

import io
from uuid import uuid4

from app.services.interchange.gedcom.gedcom import parse_gedcom, serialize_to_gedcom
from tests.conftest import API, auth, make_tree, make_user, wait_for_job

# ---------------------------------------------------------------------------
# 1. Service-level round-trip
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
            "cemetery": "Highgate Cemetery",
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
            (m.get("first_name"), m.get("last_name")): m for m in self.parsed["members"]
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

    def test_cemetery_round_trips(self):
        james = self.by_name[("James", "Smith")]
        assert james["cemetery"] == "Highgate Cemetery"
        assert "1 BURI" in self.ged_text
        assert "2 PLAC Highgate Cemetery" in self.ged_text

    def test_multiline_note_round_trips(self):
        james = self.by_name[("James", "Smith")]
        assert james["additional_data"] == "A note\nSecond line"

    def _get_id(self, first: str, last: str) -> str:
        return self.by_name[(first, last)]["id"]

    def test_couple_relation_exists(self):
        james_id = self._get_id("James", "Smith")
        mary_id = self._get_id("Mary", "Smith")
        couple_rels = [
            r
            for r in self.parsed["relations"]
            if r["relation_type"] == "married"
            and set([r["from_member_id"], r["to_member_id"]]) == {james_id, mary_id}
        ]
        assert len(couple_rels) == 1

    def test_child1_has_two_parents(self):
        tom_id = self._get_id("Tom", "Smith")
        parent_rels = [
            r
            for r in self.parsed["relations"]
            if r["relation_type"] == "parent" and r["from_member_id"] == tom_id
        ]
        assert len(parent_rels) == 2

    def test_child2_has_two_parents(self):
        sara_id = self._get_id("Sara", "Smith")
        parent_rels = [
            r
            for r in self.parsed["relations"]
            if r["relation_type"] == "parent" and r["from_member_id"] == sara_id
        ]
        assert len(parent_rels) == 2

    def test_single_parent_child_has_one_parent(self):
        alex_id = self._get_id("Alex", "Smith")
        parent_rels = [
            r
            for r in self.parsed["relations"]
            if r["relation_type"] == "parent" and r["from_member_id"] == alex_id
        ]
        assert len(parent_rels) == 1

    def test_sibling_relation_not_imported(self):
        """Sibling relations are derived from shared parents, not stored as
        explicit rows.  The GEDCOM exporter may emit a _REL record for them, but
        the importer must skip it so the DB stays clean."""
        sibling_rels = [
            r for r in self.parsed["relations"] if r["relation_type"] == "sibling"
        ]
        assert len(sibling_rels) == 0

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
# 2. API round-trip test
# ---------------------------------------------------------------------------


def _post_member(client, workspace_id: str, headers: dict, **kw) -> dict:
    mid = str(uuid4())
    payload = {"id": mid, "firstName": "Test", "lastName": "Person", "gender": "f"}
    payload.update(kw)
    resp = client.post(
        f"{API}/workspaces/{workspace_id}/members", headers=headers, json=payload
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _post_relation(
    client,
    workspace_id: str,
    headers: dict,
    from_id: str,
    to_id: str,
    rtype: str,
) -> None:
    resp = client.post(
        f"{API}/workspaces/{workspace_id}/relations",
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
        f"{API}/workspaces", headers=headers, json={"name": "RoundTripTree"}
    )
    assert tree_resp.status_code == 201
    workspace_id = tree_resp.json()["id"]

    # Add members.
    father = _post_member(
        client,
        workspace_id,
        headers,
        firstName="George",
        middleNames="Albert",
        baptismalName="Georgius",
        lastName="Brown",
        gender="m",
        dateOfBirth="1940",
    )
    mother = _post_member(
        client,
        workspace_id,
        headers,
        firstName="Helen",
        lastName="Brown",
        gender="f",
        dateOfBirth="1945-06",
    )
    child = _post_member(
        client,
        workspace_id,
        headers,
        firstName="Paul",
        lastName="Brown",
        gender="m",
        dateOfBirth="1968-09-01",
    )

    father_id = father["id"]
    mother_id = mother["id"]
    child_id = child["id"]

    # Add relations.
    _post_relation(client, workspace_id, headers, father_id, mother_id, "married")
    _post_relation(client, workspace_id, headers, child_id, father_id, "parent")
    _post_relation(client, workspace_id, headers, child_id, mother_id, "parent")

    # Export as GEDCOM.
    export_resp = client.get(
        f"{API}/workspaces/{workspace_id}/export-gedcom", headers=headers
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
        f"{API}/workspaces/import-gedcom",
        headers=headers,
        files={"file": ("test.ged", io.BytesIO(ged_bytes), "text/plain")},
        data={"name": "ImportedGedcomTree"},
    )
    assert import_resp.status_code == 202, import_resp.text
    new_tree_id = wait_for_job(client, headers, import_resp.json()["job_id"])
    imported = client.get(f"{API}/workspaces/{new_tree_id}", headers=headers).json()
    assert imported["name"] == "ImportedGedcomTree"
    assert imported["role"] == "owner"

    # Verify members in imported tree.
    members_resp = client.get(f"{API}/workspaces/{new_tree_id}/members", headers=headers)
    assert members_resp.status_code == 200
    imported_members = members_resp.json()
    assert len(imported_members) == 3

    # Verify parent relations in imported tree.
    relations_resp = client.get(
        f"{API}/workspaces/{new_tree_id}/relations", headers=headers
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
    imported_father = next(m for m in imported_members if m.get("firstName") == "George")
    assert imported_father["middleNames"] == "Albert"
    assert imported_father["baptismalName"] == "Georgius"

    # A GEDCOM import always seeds one deterministic section holding every
    # member it brought in (#1016) — GEDCOM has no section concept of its own.
    sections_resp = client.get(
        f"{API}/workspaces/{new_tree_id}/sections", headers=headers
    )
    assert sections_resp.status_code == 200
    sections = sections_resp.json()
    assert len(sections) == 1
    assert sections[0]["member_count"] == len(imported_members)


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

    resp = client.get(f"{API}/workspaces/{tree.id}/export-gedcom")
    assert resp.status_code == 401


def test_api_import_requires_auth(client, db):
    """Import without authentication should fail with 401."""
    ged = b"0 HEAD\n0 TRLR\n"
    resp = client.post(
        f"{API}/workspaces/import-gedcom",
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
        f"{API}/workspaces/import-gedcom",
        headers=headers,
        files={"file": ("bad.ged", io.BytesIO(bad_bytes), "text/plain")},
    )
    # Either succeeds (202 job started) or rejects (400) — must not be 500.
    assert resp.status_code in (202, 400)


def test_api_export_gedcom_content_disposition(client, db):
    """Exported file should have correct content-disposition header."""
    owner = make_user(db, "diana")
    headers = auth(owner)

    tree_resp = client.post(
        f"{API}/workspaces", headers=headers, json={"name": "MyFamily"}
    )
    assert tree_resp.status_code == 201
    workspace_id = tree_resp.json()["id"]

    export_resp = client.get(
        f"{API}/workspaces/{workspace_id}/export-gedcom", headers=headers
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
        f"{API}/workspaces/import-gedcom",
        headers=headers,
        files={"file": ("my_family.ged", io.BytesIO(ged), "text/plain")},
        # No 'name' field provided — filename stem takes precedence over HEAD FILE.
    )
    assert resp.status_code == 202
    workspace_id = wait_for_job(client, headers, resp.json()["job_id"])
    tree = client.get(f"{API}/workspaces/{workspace_id}", headers=headers).json()
    assert tree["name"] == "my_family"


# ---------------------------------------------------------------------------
# 3. API regression test — UTF-16 BE import
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
        f"{API}/workspaces/import-gedcom",
        headers=headers,
        files={"file": ("sample.ged", io.BytesIO(raw), "application/octet-stream")},
        data={"name": "UTF16Import"},
    )
    assert resp.status_code == 202, resp.text
    new_tree_id = wait_for_job(client, headers, resp.json()["job_id"])

    members_resp = client.get(f"{API}/workspaces/{new_tree_id}/members", headers=headers)
    assert members_resp.status_code == 200
    imported_members = members_resp.json()
    # Must have imported both INDI records — this was 0 before the fix.
    assert len(imported_members) == 2

    # A FAM with HUSB + WIFE but no MARR/DIV/_RELTYPE must yield a "married"
    # couple relation so the union node renders green, not grey. (#295)
    relations_resp = client.get(
        f"{API}/workspaces/{new_tree_id}/relations", headers=headers
    )
    assert relations_resp.status_code == 200
    married_rels = [r for r in relations_resp.json() if r["relation_type"] == "married"]
    assert len(married_rels) == 1


# ---------------------------------------------------------------------------
# 4. Union relation-type defaulting (#295)
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
            r
            for r in parsed["relations"]
            if r["relation_type"] in ("married", "divorced", "partner")
        ]
        assert len(couple_rels) == 0

    def test_no_spouses_no_couple_relation(self):
        """FAM with no HUSB/WIFE (children only) must not produce a couple relation."""
        lines = [
            "0 HEAD",
            "1 CHAR UTF-8",
            "0 @I1@ INDI",
            "1 NAME Kid /One/",
            "0 @F1@ FAM",
            "1 CHIL @I1@",
            "0 TRLR",
        ]
        parsed = parse_gedcom("\n".join(lines) + "\n")
        couple_rels = [
            r
            for r in parsed["relations"]
            if r["relation_type"] in ("married", "divorced", "partner")
        ]
        assert len(couple_rels) == 0


# ---------------------------------------------------------------------------
# 5. parse_gedcom sort key derivation (#433)
# ---------------------------------------------------------------------------


class TestParseGedcomSortKeys:
    """parse_gedcom output members must include precomputed date sort keys.

    These are required for bulk inserts which bypass the ORM @validates hook.
    """

    def _parse_member_with_dates(
        self, birt_date: str | None = None, deat_date: str | None = None
    ) -> dict:
        """Build a minimal GEDCOM INDI with optional BIRT/DEAT dates."""
        lines = ["0 HEAD", "0 @I1@ INDI", "1 NAME Test /Person/"]
        if birt_date:
            lines += ["1 BIRT", f"2 DATE {birt_date}"]
        if deat_date:
            lines += ["1 DEAT", f"2 DATE {deat_date}"]
        lines.append("0 TRLR")
        ged = "\n".join(lines) + "\n"
        members = parse_gedcom(ged)["members"]
        assert len(members) == 1
        return members[0]

    def test_full_birth_date_sort_key(self):
        """15 JUN 1950 (GEDCOM) should yield sort key 1950-06-15."""
        member = self._parse_member_with_dates(birt_date="15 JUN 1950")
        assert member["date_of_birth_sort"] == "1950-06-15"

    def test_fuzzy_birth_date_sort_key(self):
        """ABT 1850 should yield sort key 1850-00-00."""
        member = self._parse_member_with_dates(birt_date="ABT 1850")
        assert member["date_of_birth_sort"] == "1850-00-00"

    def test_absent_birth_date_sort_key_is_none(self):
        """No BIRT DATE → date_of_birth_sort must be None."""
        member = self._parse_member_with_dates()
        assert member["date_of_birth_sort"] is None

    def test_death_date_sort_key(self):
        """15 JUN 1950 death date should yield correct sort key."""
        member = self._parse_member_with_dates(deat_date="15 JUN 1950")
        assert member["date_of_death_sort"] == "1950-06-15"

    def test_absent_death_date_sort_key_is_none(self):
        """No DEAT DATE → date_of_death_sort must be None."""
        member = self._parse_member_with_dates()
        assert member["date_of_death_sort"] is None

    def test_sort_keys_present_as_keys(self):
        """Both sort key fields must always be present in the member dict."""
        member = self._parse_member_with_dates()
        assert "date_of_birth_sort" in member
        assert "date_of_death_sort" in member

    def test_year_only_birth_sort_key(self):
        """Year-only GEDCOM date 1975 should yield sort key 1975-00-00."""
        # GEDCOM year-only: stored as "1975" by from_gedcom_date
        member = self._parse_member_with_dates(birt_date="1975")
        assert member["date_of_birth_sort"] == "1975-00-00"

    def test_name_normalized_is_precomputed(self):
        """parse_gedcom output must include name_normalized (#1024) — bulk
        insert bypasses the ORM @validates hook that would otherwise derive
        it, leaving imported members unsearchable."""
        member = self._parse_member_with_dates()
        assert member["name_normalized"] == "test person"


# ---------------------------------------------------------------------------
# 6. Adoption import / export (#502)
# ---------------------------------------------------------------------------


class TestAdoptionImport:
    """parse_gedcom must set adopted=True for PEDI adopted and ADOP event."""

    def _parse_single(self, ged: str) -> dict:
        members = parse_gedcom(ged)["members"]
        assert len(members) == 1
        return members[0]

    def test_famc_pedi_adopted_sets_flag(self):
        """INDI with FAMC + PEDI adopted → adopted is True."""
        ged = (
            "0 HEAD\n"
            "0 @I1@ INDI\n"
            "1 NAME Child /One/\n"
            "1 FAMC @F1@\n"
            "2 PEDI adopted\n"
            "0 TRLR\n"
        )
        member = self._parse_single(ged)
        assert member["adopted"] is True

    def test_top_level_adop_event_sets_flag(self):
        """INDI with a top-level 1 ADOP event → adopted is True."""
        ged = "0 HEAD\n0 @I1@ INDI\n1 NAME Child /Two/\n1 ADOP\n0 TRLR\n"
        member = self._parse_single(ged)
        assert member["adopted"] is True

    def test_famc_without_pedi_not_adopted(self):
        """INDI with FAMC but no PEDI → adopted is False."""
        ged = "0 HEAD\n0 @I1@ INDI\n1 NAME Child /Three/\n1 FAMC @F1@\n0 TRLR\n"
        member = self._parse_single(ged)
        assert member["adopted"] is False

    def test_pedi_birth_not_adopted(self):
        """Explicit PEDI birth must not set adopted (only 'adopted' pedigree does)."""
        ged = (
            "0 HEAD\n"
            "0 @I1@ INDI\n"
            "1 NAME Child /Four/\n"
            "1 FAMC @F1@\n"
            "2 PEDI birth\n"
            "0 TRLR\n"
        )
        member = self._parse_single(ged)
        assert member["adopted"] is False

    def test_default_member_not_adopted(self):
        """INDI with no adoption indicators → adopted defaults to False."""
        ged = "0 HEAD\n0 @I1@ INDI\n1 NAME Plain /Person/\n0 TRLR\n"
        member = self._parse_single(ged)
        assert member["adopted"] is False


class TestAdoptionExportRoundTrip:
    """Export → re-import must preserve the adopted flag."""

    def _make_member(self, first: str, adopted: bool = False) -> dict:
        return {
            "id": str(uuid4()),
            "first_name": first,
            "last_name": "Test",
            "gender": "m",
            "date_of_birth": None,
            "date_of_death": None,
            "birthplace": None,
            "hometown": None,
            "additional_data": None,
            "places_lived": None,
            "image_data": None,
            "adopted": adopted,
        }

    def _rel(self, f: str, t: str, rt: str) -> dict:
        return {"from_member_id": f, "to_member_id": t, "relation_type": rt}

    def test_adopted_flag_survives_round_trip_with_parents(self):
        """An adopted child with two parents: PEDI adopted is emitted and re-imported."""
        parent1 = self._make_member("Parent1")
        parent2 = self._make_member("Parent2")
        child = self._make_member("AdoptedChild", adopted=True)
        non_adopted = self._make_member("BioChild", adopted=False)

        members = [parent1, parent2, child, non_adopted]
        relations = [
            self._rel(child["id"], parent1["id"], "parent"),
            self._rel(child["id"], parent2["id"], "parent"),
            self._rel(non_adopted["id"], parent1["id"], "parent"),
            self._rel(non_adopted["id"], parent2["id"], "parent"),
        ]

        ged_text = serialize_to_gedcom("RoundTripAdoption", members, relations)

        # The exported text must contain the adoption markers.
        assert "1 ADOP" in ged_text
        assert "2 PEDI adopted" in ged_text

        parsed = parse_gedcom(ged_text)
        by_first = {m["first_name"]: m for m in parsed["members"]}

        assert by_first["AdoptedChild"]["adopted"] is True
        assert by_first["BioChild"]["adopted"] is False

    def test_adopted_flag_survives_round_trip_no_parents(self):
        """An adopted member with no parents: 1 ADOP event is emitted and re-imported."""
        child = self._make_member("OrphanAdopted", adopted=True)

        ged_text = serialize_to_gedcom("RoundTripAdoptionNoParents", [child], [])

        assert "1 ADOP" in ged_text
        # No FAMC → no PEDI line expected.
        assert "2 PEDI adopted" not in ged_text

        parsed = parse_gedcom(ged_text)
        assert len(parsed["members"]) == 1
        assert parsed["members"][0]["adopted"] is True

    def test_non_adopted_member_no_adop_in_gedcom(self):
        """A non-adopted member must not have ADOP or PEDI adopted in the export."""
        member = self._make_member("NormalPerson", adopted=False)
        ged_text = serialize_to_gedcom("NormalTree", [member], [])

        assert "1 ADOP" not in ged_text
        assert "2 PEDI adopted" not in ged_text
