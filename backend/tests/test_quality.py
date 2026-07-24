"""Tests for the data-quality report (issue #164, dismissals issue #521)."""

from app.models.content import Event, EventMemberLink
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
        assert first[0].id == second[0].id

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


def _event(eid: str, date: str, event_type: str = "marriage") -> Event:
    return Event(
        id=eid, tree_id="t1", event_type=event_type, date=date, created_at="2020"
    )


def _event_link(eid: str, mid: str) -> EventMemberLink:
    return EventMemberLink(event_id=eid, member_id=mid)


class TestBirthAfterDeath:
    def test_detects_birth_after_death(self):
        m = _member("m1", date_of_birth="2010", date_of_death="2005")
        issues = run_quality_checks([m], [])
        types = [i.issue_type for i in issues]
        assert "birth_after_death" in types

    def test_valid_dates_no_issue(self):
        m = _member("m1", date_of_birth="1980", date_of_death="2020")
        issues = run_quality_checks([m], [])
        assert not any(i.issue_type == "birth_after_death" for i in issues)

    def test_same_year_is_ok(self):
        m = _member("m1", date_of_birth="2000", date_of_death="2000")
        issues = run_quality_checks([m], [])
        assert not any(i.issue_type == "birth_after_death" for i in issues)

    def test_partial_date_year_only(self):
        m = _member("m1", date_of_birth="2010-06", date_of_death="2005-01")
        issues = run_quality_checks([m], [])
        assert any(i.issue_type == "birth_after_death" for i in issues)


class TestParentChildAgeGap:
    def test_child_older_than_parent_is_error(self):
        parent = _member("p1", date_of_birth="1990")
        child = _member("c1", date_of_birth="1980")
        # from=child, to=parent
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        assert any(i.issue_type == "child_older_than_parent" for i in issues)

    def test_parent_too_young_is_warning(self):
        parent = _member("p1", date_of_birth="1990")
        child = _member("c1", date_of_birth="1995")  # parent was 5
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        assert any(i.issue_type == "parent_too_young" for i in issues)

    def test_normal_age_gap_is_clean(self):
        parent = _member("p1", date_of_birth="1950")
        child = _member("c1", date_of_birth="1980")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        gap_issues = {"child_older_than_parent", "parent_too_young", "parent_too_old"}
        assert not any(i.issue_type in gap_issues for i in issues)

    def test_parent_too_old_is_warning(self):
        parent = _member("p1", date_of_birth="1800")
        child = _member("c1", date_of_birth="1950")  # parent was 150
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        assert any(i.issue_type == "parent_too_old" for i in issues)

    def test_missing_dates_skipped(self):
        parent = _member("p1")
        child = _member("c1", date_of_birth="1990")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        gap_issues = {"child_older_than_parent", "parent_too_young", "parent_too_old"}
        assert not any(i.issue_type in gap_issues for i in issues)


class TestChildAfterParentDeath:
    def test_child_born_after_mother_death_is_flagged(self):
        mother = _member("p1", date_of_death="1900", gender="f")
        child = _member("c1", date_of_birth="1910")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([mother, child], [rel])
        assert any(i.issue_type == "child_after_parent_death" for i in issues)

    def test_child_born_year_after_mother_death_is_flagged(self):
        # Mothers get no grace window: a birth after death is impossible.
        mother = _member("p1", date_of_death="1900", gender="f")
        child = _member("c1", date_of_birth="1901")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([mother, child], [rel])
        assert any(i.issue_type == "child_after_parent_death" for i in issues)

    def test_child_born_after_father_death_beyond_grace_is_flagged(self):
        father = _member("p1", date_of_death="1900", gender="m")
        child = _member("c1", date_of_birth="1905")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([father, child], [rel])
        assert any(i.issue_type == "child_after_parent_death" for i in issues)

    def test_posthumous_birth_within_father_grace_is_clean(self):
        # A child born the year after the father's death is a plausible
        # posthumous birth and must not be flagged.
        father = _member("p1", date_of_death="1900", gender="m")
        child = _member("c1", date_of_birth="1901")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([father, child], [rel])
        assert not any(i.issue_type == "child_after_parent_death" for i in issues)

    def test_unknown_gender_uses_father_grace(self):
        parent = _member("p1", date_of_death="1900")  # gender unset
        child = _member("c1", date_of_birth="1901")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        assert not any(i.issue_type == "child_after_parent_death" for i in issues)

    def test_child_born_before_parent_death_is_clean(self):
        parent = _member("p1", date_of_birth="1850", date_of_death="1900", gender="f")
        child = _member("c1", date_of_birth="1880")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        assert not any(i.issue_type == "child_after_parent_death" for i in issues)

    def test_child_born_same_year_as_parent_death_is_clean(self):
        parent = _member("p1", date_of_death="1900", gender="f")
        child = _member("c1", date_of_birth="1900")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        assert not any(i.issue_type == "child_after_parent_death" for i in issues)

    def test_parent_without_death_date_skipped(self):
        parent = _member("p1", date_of_birth="1850", gender="f")
        child = _member("c1", date_of_birth="1880")
        rel = _relation("c1", "p1")
        issues = run_quality_checks([parent, child], [rel])
        assert not any(i.issue_type == "child_after_parent_death" for i in issues)


class TestRelationshipCycle:
    def test_self_loop_is_cycle(self):
        m = _member("m1")
        rel = _relation("m1", "m1")
        issues = run_quality_checks([m], [rel])
        assert any(i.issue_type == "relationship_cycle" for i in issues)

    def test_two_node_cycle(self):
        a = _member("a")
        b = _member("b")
        # a's parent is b, b's parent is a → cycle
        issues = run_quality_checks([a, b], [_relation("a", "b"), _relation("b", "a")])
        assert any(i.issue_type == "relationship_cycle" for i in issues)

    def test_linear_chain_no_cycle(self):
        g = _member("g")
        p = _member("p")
        c = _member("c")
        issues = run_quality_checks([g, p, c], [_relation("p", "g"), _relation("c", "p")])
        assert not any(i.issue_type == "relationship_cycle" for i in issues)


class TestDuplicateCandidates:
    def test_same_name_flagged(self):
        m1 = _member("m1", first_name="John", last_name="Doe")
        m2 = _member("m2", first_name="John", last_name="Doe")
        issues = run_quality_checks([m1, m2], [])
        assert any(i.issue_type == "duplicate_candidate" for i in issues)

    def test_case_insensitive(self):
        m1 = _member("m1", first_name="john", last_name="doe")
        m2 = _member("m2", first_name="John", last_name="Doe")
        issues = run_quality_checks([m1, m2], [])
        assert any(i.issue_type == "duplicate_candidate" for i in issues)

    def test_different_names_not_flagged(self):
        m1 = _member("m1", first_name="John", last_name="Doe")
        m2 = _member("m2", first_name="Jane", last_name="Doe")
        issues = run_quality_checks([m1, m2], [])
        assert not any(i.issue_type == "duplicate_candidate" for i in issues)

    def test_empty_names_not_flagged(self):
        m1 = _member("m1")
        m2 = _member("m2")
        issues = run_quality_checks([m1, m2], [])
        assert not any(i.issue_type == "duplicate_candidate" for i in issues)


class TestDisconnectedMembers:
    def test_solo_tree_not_flagged(self):
        m = _member("m1")
        issues = run_quality_checks([m], [])
        assert not any(i.issue_type == "disconnected_member" for i in issues)

    def test_isolated_member_in_multi_member_tree(self):
        m1 = _member("m1")
        m2 = _member("m2")
        m3 = _member("m3")
        rel = _relation("m2", "m1")  # m1 and m2 connected; m3 isolated
        issues = run_quality_checks([m1, m2, m3], [rel])
        disconnected = [i for i in issues if i.issue_type == "disconnected_member"]
        assert len(disconnected) == 1
        assert disconnected[0].member_ids == ["m3"]

    def test_all_connected_no_issues(self):
        m1 = _member("m1")
        m2 = _member("m2")
        rel = _relation("m1", "m2")
        issues = run_quality_checks([m1, m2], [rel])
        assert not any(i.issue_type == "disconnected_member" for i in issues)


class TestEventAfterDeath:
    def test_event_after_death_flagged(self):
        m = _member("m1", date_of_death="1900")
        ev = _event("e1", date="1910")
        issues = run_quality_checks(
            [m], [], events=[ev], event_links=[_event_link("e1", "m1")]
        )
        assert any(i.issue_type == "event_after_death" for i in issues)

    def test_partial_dates_year_only(self):
        m = _member("m1", date_of_death="1900-01")
        ev = _event("e1", date="1910-06")
        issues = run_quality_checks(
            [m], [], events=[ev], event_links=[_event_link("e1", "m1")]
        )
        assert any(i.issue_type == "event_after_death" for i in issues)

    def test_event_before_death_not_flagged(self):
        m = _member("m1", date_of_death="1900")
        ev = _event("e1", date="1890")
        issues = run_quality_checks(
            [m], [], events=[ev], event_links=[_event_link("e1", "m1")]
        )
        assert not any(i.issue_type == "event_after_death" for i in issues)

    def test_same_year_not_flagged(self):
        m = _member("m1", date_of_death="1900")
        ev = _event("e1", date="1900")
        issues = run_quality_checks(
            [m], [], events=[ev], event_links=[_event_link("e1", "m1")]
        )
        assert not any(i.issue_type == "event_after_death" for i in issues)

    def test_burial_event_excluded(self):
        m = _member("m1", date_of_death="1900")
        ev = _event("e1", date="1910", event_type="burial")
        issues = run_quality_checks(
            [m], [], events=[ev], event_links=[_event_link("e1", "m1")]
        )
        assert not any(i.issue_type == "event_after_death" for i in issues)

    def test_no_death_date_not_flagged(self):
        m = _member("m1")
        ev = _event("e1", date="1910")
        issues = run_quality_checks(
            [m], [], events=[ev], event_links=[_event_link("e1", "m1")]
        )
        assert not any(i.issue_type == "event_after_death" for i in issues)

    def test_multi_member_event_flags_only_deceased(self):
        alive = _member("m1")
        dead = _member("m2", date_of_death="1900")
        ev = _event("e1", date="1950")
        issues = run_quality_checks(
            [alive, dead],
            [],
            events=[ev],
            event_links=[_event_link("e1", "m1"), _event_link("e1", "m2")],
        )
        flagged = [i for i in issues if i.issue_type == "event_after_death"]
        assert len(flagged) == 1
        assert flagged[0].member_ids == ["m2"]

    def test_distinct_ids_for_multiple_offending_events(self):
        m = _member("m1", date_of_death="1900")
        ev1 = _event("e1", date="1910")
        ev2 = _event("e2", date="1920")
        issues = run_quality_checks(
            [m],
            [],
            events=[ev1, ev2],
            event_links=[_event_link("e1", "m1"), _event_link("e2", "m1")],
        )
        flagged = [i for i in issues if i.issue_type == "event_after_death"]
        assert len(flagged) == 2
        assert flagged[0].id != flagged[1].id


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


def test_quality_report_child_after_parent_death(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "p1", first_name="Mom", date_of_death="1900", gender="f")
    add_member(db, tree, "c1", first_name="Kid", date_of_birth="1910")
    _add_relation(client, tree.id, "c1", "p1", "parent", auth(owner))

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(owner))
    assert res.status_code == 200
    types = [i["issue_type"] for i in res.json()["issues"]]
    assert "child_after_parent_death" in types


def _add_event(client, tree_id, eid, date, member_ids, headers, event_type="marriage"):
    return client.post(
        f"{API}/trees/{tree_id}/events",
        headers=headers,
        json={
            "id": eid,
            "event_type": event_type,
            "date": date,
            "created_at": "2020",
            "member_ids": member_ids,
        },
    )


def test_quality_report_event_after_death(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Dead", date_of_death="1900")
    res = _add_event(client, tree.id, "e1", "1950", ["m1"], auth(owner))
    assert res.status_code in (200, 201)

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(owner))
    assert res.status_code == 200
    types = [i["issue_type"] for i in res.json()["issues"]]
    assert "event_after_death" in types


def test_quality_report_event_after_death_dismiss_roundtrip(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Dead", date_of_death="1900")
    _add_event(client, tree.id, "e1", "1950", ["m1"], auth(owner))

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(owner))
    issue = next(
        i for i in res.json()["issues"] if i["issue_type"] == "event_after_death"
    )

    res = client.post(
        f"{API}/trees/{tree.id}/quality-report/issues/{issue['id']}/dismiss",
        headers=auth(owner),
    )
    assert res.status_code == 204

    res = client.get(f"{API}/trees/{tree.id}/quality-report", headers=auth(owner))
    types = [i["issue_type"] for i in res.json()["issues"]]
    assert "event_after_death" not in types


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


# ---------------------------------------------------------------------------
# Bridge-person drift (tree-in-tree)
# ---------------------------------------------------------------------------


def _make_bridge(client, db, user, first_name="Jo"):
    """Owner's tree with member m1 bridged into a fresh linked subtree."""
    main = make_tree(db, user, "Main")
    client.post(
        f"{API}/trees/{main.id}/members",
        headers=auth(user),
        json={"id": "m1", "firstName": first_name, "lastName": "Doe", "gender": "f"},
    )
    created = client.post(
        f"{API}/trees/{main.id}/members/m1/subtree",
        headers=auth(user),
        json={"name": "Sub"},
    )
    assert created.status_code == 201
    body = created.json()
    return main, body["tree"]["id"], body["anchor"]["linkedMemberId"]


def _drift_issues(client, user, tree_id):
    res = client.get(f"{API}/trees/{tree_id}/quality-report", headers=auth(user))
    assert res.status_code == 200
    return [
        i for i in res.json()["issues"] if i["issue_type"] == "bridge_person_drift"
    ]


def test_bridge_drift_detected_in_quality_report(client, db):
    from app.models.family import Member as MemberModel

    user = make_user(db, "alice")
    main, sub_id, counterpart_id = _make_bridge(client, db, user)

    # In sync right after creation: no drift note.
    assert _drift_issues(client, user, main.id) == []

    # Drift the counterpart directly (bypassing the mirroring route logic).
    counterpart = db.get(MemberModel, counterpart_id)
    counterpart.first_name = "Johanna"
    counterpart.birthplace = "Linz"
    db.commit()

    issues = _drift_issues(client, user, main.id)
    assert len(issues) == 1
    assert issues[0]["member_ids"] == ["m1"]
    assert "first name" in issues[0]["description"]
    assert "birthplace" in issues[0]["description"]
    # The linked tree's report shows the mirror-image note.
    assert len(_drift_issues(client, user, sub_id)) == 1


def test_bridge_drift_resolve_push_and_pull(client, db):
    from app.models.family import Member as MemberModel

    user = make_user(db, "alice")
    main, sub_id, counterpart_id = _make_bridge(client, db, user)
    counterpart = db.get(MemberModel, counterpart_id)
    counterpart.first_name = "Johanna"
    db.commit()

    # push: this tree's values win.
    res = client.post(
        f"{API}/trees/{main.id}/members/m1/bridge-sync",
        headers=auth(user),
        json={"direction": "push"},
    )
    assert res.status_code == 200
    db.expire_all()
    assert db.get(MemberModel, counterpart_id).first_name == "Jo"
    assert _drift_issues(client, user, main.id) == []

    # pull: the linked tree's values win.
    counterpart = db.get(MemberModel, counterpart_id)
    counterpart.first_name = "Johanna"
    db.commit()
    res = client.post(
        f"{API}/trees/{main.id}/members/m1/bridge-sync",
        headers=auth(user),
        json={"direction": "pull"},
    )
    assert res.status_code == 200
    assert res.json()["firstName"] == "Johanna"
    assert _drift_issues(client, user, main.id) == []


def test_bridge_drift_resolve_requires_access_to_other_tree(client, db):
    from tests.conftest import share

    owner = make_user(db, "alice")
    editor = make_user(db, "bob")
    main, _sub_id, _counterpart_id = _make_bridge(client, db, owner)
    share(db, main, editor, role="editor")

    res = client.post(
        f"{API}/trees/{main.id}/members/m1/bridge-sync",
        headers=auth(editor),
        json={"direction": "push"},
    )
    assert res.status_code == 403


def test_bridge_drift_hidden_when_flag_off(client, db):
    from app.models.family import Member as MemberModel
    from app.services import feature_service

    user = make_user(db, "alice")
    main, _sub_id, counterpart_id = _make_bridge(client, db, user)
    counterpart = db.get(MemberModel, counterpart_id)
    counterpart.first_name = "Johanna"
    db.commit()

    feature_service.set_state(db, "tree_links", "off")
    db.commit()
    try:
        assert _drift_issues(client, user, main.id) == []
    finally:
        feature_service.set_state(db, "tree_links", "on")
        db.commit()
