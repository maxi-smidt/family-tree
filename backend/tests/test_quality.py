"""Tests for the data-quality report (issue #164, dismissals issue #521)."""

from app.models.family import Member, Relation
from app.services.quality_checks import issue_id_for, run_quality_checks
from tests.conftest import (
    API,
    add_member,
    auth,
    make_tree,
    make_user,
)

# ---------------------------------------------------------------------------
# Unit tests for quality check logic
# ---------------------------------------------------------------------------


class TestIssueId:
    def test_stable_across_calls(self):
        m = _member("m1", date_of_birth="2010", date_of_death="2005")
        first = run_quality_checks([m], [])
        second = run_quality_checks([m], [])
        assert first[0]["id"] == second[0]["id"]

    def test_order_independent_for_member_ids(self):
        assert issue_id_for("duplicate_candidate", ["a", "b"]) == issue_id_for(
            "duplicate_candidate", ["b", "a"]
        )

    def test_differs_by_type(self):
        assert issue_id_for("type_a", ["a"]) != issue_id_for("type_b", ["a"])


def _member(mid: str, **kw) -> Member:
    return Member(id=mid, tree_id="t1", **kw)


def _relation(from_id: str, to_id: str, rtype: str = "parent") -> Relation:
    return Relation(
        tree_id="t1", from_member_id=from_id, to_member_id=to_id, relation_type=rtype
    )


class TestBirthAfterDeath:
    def test_detects_birth_after_death(self):
        m = _member("m1", date_of_birth="2010", date_of_death="2005")
        issues = run_quality_checks([m], [])
        types = [i["issue_type"] for i in issues]
        assert "birth_after_death" in types

    def test_valid_dates_no_issue(self):
        m = _member("m1", date_of_birth="1980", date_of_death="2020")
        issues = run_quality_checks([m], [])
        assert not any(i["issue_type"] == "birth_after_death" for i in issues)

    def test_same_year_is_ok(self):
        m = _member("m1", date_of_birth="2000", date_of_death="2000")
        issues = run_quality_checks([m], [])
        assert not any(i["issue_type"] == "birth_after_death" for i in issues)

    def test_partial_date_year_only(self):
        m = _member("m1", date_of_birth="2010-06", date_of_death="2005-01")
        issues = run_quality_checks([m], [])
        assert any(i["issue_type"] == "birth_after_death" for i in issues)


class TestParentChildAgeGap:
    def test_child_older_than_parent_is_error(self):
        parent = _member("p1", date_of_birth="1990")
        child = _member("c1", date_of_birth="1980")
        # from=child, to=parent
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        assert any(i["issue_type"] == "child_older_than_parent" for i in issues)

    def test_parent_too_young_is_warning(self):
        parent = _member("p1", date_of_birth="1990")
        child = _member("c1", date_of_birth="1995")  # parent was 5
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        assert any(i["issue_type"] == "parent_too_young" for i in issues)

    def test_normal_age_gap_is_clean(self):
        parent = _member("p1", date_of_birth="1950")
        child = _member("c1", date_of_birth="1980")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        gap_issues = {"child_older_than_parent", "parent_too_young", "parent_too_old"}
        assert not any(i["issue_type"] in gap_issues for i in issues)

    def test_parent_too_old_is_warning(self):
        parent = _member("p1", date_of_birth="1800")
        child = _member("c1", date_of_birth="1950")  # parent was 150
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        assert any(i["issue_type"] == "parent_too_old" for i in issues)

    def test_missing_dates_skipped(self):
        parent = _member("p1")
        child = _member("c1", date_of_birth="1990")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        gap_issues = {"child_older_than_parent", "parent_too_young", "parent_too_old"}
        assert not any(i["issue_type"] in gap_issues for i in issues)


class TestRelationshipCycle:
    def test_self_loop_is_cycle(self):
        m = _member("m1")
        rel = _relation("m1", "m1")
        issues = run_quality_checks([m], [rel])
        assert any(i["issue_type"] == "relationship_cycle" for i in issues)

    def test_two_node_cycle(self):
        a = _member("a")
        b = _member("b")
        # a's parent is b, b's parent is a → cycle
        issues = run_quality_checks([a, b], [_relation("a", "b"), _relation("b", "a")])
        assert any(i["issue_type"] == "relationship_cycle" for i in issues)

    def test_linear_chain_no_cycle(self):
        g = _member("g")
        p = _member("p")
        c = _member("c")
        issues = run_quality_checks([g, p, c], [_relation("p", "g"), _relation("c", "p")])
        assert not any(i["issue_type"] == "relationship_cycle" for i in issues)


class TestDuplicateCandidates:
    def test_same_name_flagged(self):
        m1 = _member("m1", first_name="John", last_name="Doe")
        m2 = _member("m2", first_name="John", last_name="Doe")
        issues = run_quality_checks([m1, m2], [])
        assert any(i["issue_type"] == "duplicate_candidate" for i in issues)

    def test_case_insensitive(self):
        m1 = _member("m1", first_name="john", last_name="doe")
        m2 = _member("m2", first_name="John", last_name="Doe")
        issues = run_quality_checks([m1, m2], [])
        assert any(i["issue_type"] == "duplicate_candidate" for i in issues)

    def test_different_names_not_flagged(self):
        m1 = _member("m1", first_name="John", last_name="Doe")
        m2 = _member("m2", first_name="Jane", last_name="Doe")
        issues = run_quality_checks([m1, m2], [])
        assert not any(i["issue_type"] == "duplicate_candidate" for i in issues)

    def test_empty_names_not_flagged(self):
        m1 = _member("m1")
        m2 = _member("m2")
        issues = run_quality_checks([m1, m2], [])
        assert not any(i["issue_type"] == "duplicate_candidate" for i in issues)


class TestDisconnectedMembers:
    def test_solo_tree_not_flagged(self):
        m = _member("m1")
        issues = run_quality_checks([m], [])
        assert not any(i["issue_type"] == "disconnected_member" for i in issues)

    def test_isolated_member_in_multi_member_tree(self):
        m1 = _member("m1")
        m2 = _member("m2")
        m3 = _member("m3")
        rel = _relation("m2", "m1")  # m1 and m2 connected; m3 isolated
        issues = run_quality_checks([m1, m2, m3], [rel])
        disconnected = [i for i in issues if i["issue_type"] == "disconnected_member"]
        assert len(disconnected) == 1
        assert disconnected[0]["member_ids"] == ["m3"]

    def test_all_connected_no_issues(self):
        m1 = _member("m1")
        m2 = _member("m2")
        rel = _relation("m1", "m2")
        issues = run_quality_checks([m1, m2], [rel])
        assert not any(i["issue_type"] == "disconnected_member" for i in issues)


# ---------------------------------------------------------------------------
# Integration tests via HTTP
# ---------------------------------------------------------------------------


def _add_relation(client, tree_id, from_id, to_id, rtype, headers):
    return client.post(
        f"{API}/trees/{tree_id}/relations",
        headers=headers,
        json={"from_member_id": from_id, "to_member_id": to_id, "relation_type": rtype},
    )


def test_quality_report_empty_tree(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(owner))
    assert res.status_code == 200
    body = res.json()
    assert body["tree_id"] == tree.id
    assert body["total_members"] == 0
    assert body["issues"] == []


def test_quality_report_birth_after_death(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(
        db, tree, "m1", first_name="Bad", date_of_birth="2020", date_of_death="2010"
    )

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(owner))
    assert res.status_code == 200
    types = [i["issue_type"] for i in res.json()["issues"]]
    assert "birth_after_death" in types


def test_quality_report_viewer_can_read(client, db):
    from tests.conftest import share

    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, viewer, role="viewer")

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(viewer))
    assert res.status_code == 200


def test_quality_report_unauthorized(client, db):
    owner = make_user(db, "alice")
    outsider = make_user(db, "eve")
    tree = make_tree(db, owner)

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(outsider))
    assert res.status_code == 403


def test_quality_report_cycle_detected(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1")
    add_member(db, tree, "m2")
    _add_relation(client, tree.id, "m1", "m2", "parent", auth(owner))
    _add_relation(client, tree.id, "m2", "m1", "parent", auth(owner))

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(owner))
    assert res.status_code == 200
    types = [i["issue_type"] for i in res.json()["issues"]]
    assert "relationship_cycle" in types


def test_quality_report_duplicate_names(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="John", last_name="Doe")
    add_member(db, tree, "m2", first_name="John", last_name="Doe")

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(owner))
    assert res.status_code == 200
    types = [i["issue_type"] for i in res.json()["issues"]]
    assert "duplicate_candidate" in types


# ---------------------------------------------------------------------------
# Dismissals
# ---------------------------------------------------------------------------


def test_dismiss_issue_hides_it_by_default(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(
        db, tree, "m1", first_name="Bad", date_of_birth="2020", date_of_death="2010"
    )

    report = client.get(
        f"{API}/trees/{tree.id}/quality-report", headers=auth(owner)
    ).json()
    issue_id = report["issues"][0]["id"]

    res = client.post(
        f"{API}/trees/{tree.id}/quality-report/issues/{issue_id}/dismiss",
        headers=auth(owner),
    )
    assert res.status_code == 204

    report = client.get(
        f"{API}/trees/{tree.id}/quality-report", headers=auth(owner)
    ).json()
    assert report["issues"] == []


def test_dismissed_issue_visible_with_include_dismissed(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(
        db, tree, "m1", first_name="Bad", date_of_birth="2020", date_of_death="2010"
    )
    report = client.get(
        f"{API}/trees/{tree.id}/quality-report", headers=auth(owner)
    ).json()
    issue_id = report["issues"][0]["id"]
    client.post(
        f"{API}/trees/{tree.id}/quality-report/issues/{issue_id}/dismiss",
        headers=auth(owner),
    )

    res = client.get(
        f"{API}/trees/{tree.id}/quality-report",
        params={"include_dismissed": True},
        headers=auth(owner),
    )
    assert res.status_code == 200
    issues = res.json()["issues"]
    assert len(issues) == 1
    assert issues[0]["dismissed"] is True


def test_restore_dismissed_issue(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(
        db, tree, "m1", first_name="Bad", date_of_birth="2020", date_of_death="2010"
    )
    report = client.get(
        f"{API}/trees/{tree.id}/quality-report", headers=auth(owner)
    ).json()
    issue_id = report["issues"][0]["id"]
    client.post(
        f"{API}/trees/{tree.id}/quality-report/issues/{issue_id}/dismiss",
        headers=auth(owner),
    )

    res = client.delete(
        f"{API}/trees/{tree.id}/quality-report/issues/{issue_id}/dismiss",
        headers=auth(owner),
    )
    assert res.status_code == 204

    report = client.get(
        f"{API}/trees/{tree.id}/quality-report", headers=auth(owner)
    ).json()
    assert len(report["issues"]) == 1
    assert report["issues"][0]["dismissed"] is False


def test_dismiss_unknown_issue_404(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)

    res = client.post(
        f"{API}/trees/{tree.id}/quality-report/issues/does-not-exist/dismiss",
        headers=auth(owner),
    )
    assert res.status_code == 404


def test_dismiss_requires_write_access(client, db):
    from tests.conftest import share

    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    tree = make_tree(db, owner)
    share(db, tree, viewer, role="viewer")
    add_member(
        db, tree, "m1", first_name="Bad", date_of_birth="2020", date_of_death="2010"
    )
    report = client.get(
        f"{API}/trees/{tree.id}/quality-report", headers=auth(owner)
    ).json()
    issue_id = report["issues"][0]["id"]

    res = client.post(
        f"{API}/trees/{tree.id}/quality-report/issues/{issue_id}/dismiss",
        headers=auth(viewer),
    )
    assert res.status_code == 403


def test_dismiss_is_idempotent(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(
        db, tree, "m1", first_name="Bad", date_of_birth="2020", date_of_death="2010"
    )
    report = client.get(
        f"{API}/trees/{tree.id}/quality-report", headers=auth(owner)
    ).json()
    issue_id = report["issues"][0]["id"]

    for _ in range(2):
        res = client.post(
            f"{API}/trees/{tree.id}/quality-report/issues/{issue_id}/dismiss",
            headers=auth(owner),
        )
        assert res.status_code == 204

    report = client.get(
        f"{API}/trees/{tree.id}/quality-report",
        params={"include_dismissed": True},
        headers=auth(owner),
    ).json()
    assert len(report["issues"]) == 1
