"""Visibility-safe, section-aware workspace search (#1024)."""

from app.models import Section, SectionMember, WorkspaceSectionGrant
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _section(db, tree, name="Section") -> Section:
    section = Section(workspace_id=tree.id, name=name)
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


def _assign(db, section, member) -> None:
    db.add(SectionMember(section_id=section.id, member_id=member.id))
    db.commit()


def _grant(db, tree, section, user, role="viewer") -> WorkspaceSectionGrant:
    grant = WorkspaceSectionGrant(
        workspace_id=tree.id, section_id=section.id, user_id=user.id, role=role
    )
    db.add(grant)
    db.commit()
    db.refresh(grant)
    return grant


def _search(client, tree, user, **params):
    return client.get(
        f"{API}/workspaces/{tree.id}/search",
        headers=auth(user),
        params={"q": "a", **params},
    )


# ---------------------------------------------------------------------------
# Matching: exact, partial, Unicode, deterministic ordering
# ---------------------------------------------------------------------------


def test_partial_match_finds_a_substring_anywhere_in_the_name(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m0", first_name="Anna", last_name="Müller")

    r = _search(client, tree, user, q="mül")
    assert r.status_code == 200
    body = r.json()
    assert [item["id"] for item in body["items"]] == ["m0"]
    assert body["total"] == 1
    assert body["has_more"] is False


def test_unicode_name_matches_exactly(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m0", first_name="Björn", last_name="Åström")

    r = _search(client, tree, user, q="åström")
    assert r.status_code == 200
    assert [item["id"] for item in r.json()["items"]] == ["m0"]


def test_duplicate_names_are_ordered_deterministically_by_id(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m2", first_name="Anna", last_name="Bauer")
    add_member(db, tree, "m1", first_name="Anna", last_name="Bauer")

    r1 = _search(client, tree, user, q="anna")
    r2 = _search(client, tree, user, q="anna")
    assert [item["id"] for item in r1.json()["items"]] == ["m1", "m2"]
    assert [item["id"] for item in r1.json()["items"]] == [
        item["id"] for item in r2.json()["items"]
    ]


# ---------------------------------------------------------------------------
# Section labels: overlapping membership, unassigned, scoped hiding
# ---------------------------------------------------------------------------


def test_overlapping_sections_are_deduplicated_and_both_labeled(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    member = add_member(db, tree, "m0", first_name="Anna", last_name="Bauer")
    section_a = _section(db, tree, "Branch A")
    section_b = _section(db, tree, "Branch B")
    _assign(db, section_a, member)
    _assign(db, section_b, member)

    r = _search(client, tree, user, q="anna")
    items = r.json()["items"]
    assert len(items) == 1
    assert {s["name"] for s in items[0]["sections"]} == {"Branch A", "Branch B"}
    assert items[0]["unassigned"] is False


def test_unassigned_member_is_flagged_for_a_whole_workspace_caller(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m0", first_name="Anna", last_name="Bauer")

    r = _search(client, tree, user, q="anna")
    item = r.json()["items"][0]
    assert item["unassigned"] is True
    assert item["sections"] == []


def test_scoped_caller_only_sees_their_granted_section_label(db, client):
    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    tree = make_tree(db, owner)
    member = add_member(db, tree, "m0", first_name="Anna", last_name="Bauer")
    granted = _section(db, tree, "Granted")
    hidden = _section(db, tree, "Hidden")
    _assign(db, granted, member)
    _assign(db, hidden, member)
    _grant(db, tree, granted, viewer)

    r = _search(client, tree, viewer, q="anna")
    item = r.json()["items"][0]
    # The hidden section's membership, and its very name, must not leak.
    assert [s["name"] for s in item["sections"]] == ["Granted"]
    # A scoped caller can never distinguish "no sections" from "sections I
    # can't see" — unassigned is reserved for whole-workspace callers.
    assert item["unassigned"] is False


def test_scoped_caller_finds_nothing_outside_their_granted_sections(db, client):
    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    tree = make_tree(db, owner)
    member = add_member(db, tree, "m0", first_name="Anna", last_name="Bauer")
    granted = _section(db, tree, "Granted")
    other = _section(db, tree, "Other")
    _assign(db, other, member)
    _grant(db, tree, granted, viewer)

    r = _search(client, tree, viewer, q="anna")
    body = r.json()
    assert body["items"] == []
    assert body["total"] == 0


def test_unassigned_member_is_invisible_to_a_scoped_caller(db, client):
    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    tree = make_tree(db, owner)
    add_member(db, tree, "m0", first_name="Anna", last_name="Bauer")
    section = _section(db, tree, "Granted")
    _grant(db, tree, section, viewer)

    r = _search(client, tree, viewer, q="anna")
    assert r.json()["items"] == []


# ---------------------------------------------------------------------------
# Pagination: totals, has_more, cursor continuation, tampering, staleness
# ---------------------------------------------------------------------------


def test_pagination_cursor_continues_the_same_deterministic_sequence(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    for i in range(5):
        add_member(db, tree, f"m{i}", first_name="Anna", last_name=f"Person{i}")

    seen: list[str] = []
    cursor = None
    for _ in range(3):
        extra = {"cursor": cursor} if cursor else {}
        r = _search(client, tree, user, q="anna", limit=2, **extra)
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 5
        seen += [item["id"] for item in body["items"]]
        cursor = body["next_cursor"]
        if not body["has_more"]:
            break
    assert cursor is None
    assert seen == [f"m{i}" for i in range(5)]


def test_tampered_cursor_is_rejected(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    for i in range(3):
        add_member(db, tree, f"m{i}", first_name="Anna", last_name=f"Person{i}")

    r = _search(client, tree, user, q="anna", limit=1)
    cursor = r.json()["next_cursor"]
    tampered = cursor[:-1] + ("a" if cursor[-1] != "a" else "b")

    r2 = _search(client, tree, user, q="anna", limit=1, cursor=tampered)
    assert r2.status_code == 400


def test_cursor_from_another_workspace_is_rejected(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    other = make_tree(db, user, name="Other")
    add_member(db, tree, "m0", first_name="Anna", last_name="A")
    add_member(db, tree, "m1", first_name="Anna", last_name="B")
    add_member(db, other, "x0", first_name="Anna", last_name="X")

    r = _search(client, tree, user, q="anna", limit=1)
    cursor = r.json()["next_cursor"]

    r2 = _search(client, other, user, q="anna", limit=1, cursor=cursor)
    assert r2.status_code == 400


def test_cursor_invalidated_by_a_visibility_change(db, client):
    owner = make_user(db, "alice")
    other = make_user(db, "bob")
    tree = make_tree(db, owner)
    for i in range(3):
        add_member(db, tree, f"m{i}", first_name="Anna", last_name=f"Person{i}")
    share(db, tree, other, role="viewer")

    r = _search(client, tree, other, q="anna", limit=1)
    cursor = r.json()["next_cursor"]

    # Revoking the share changes `other`'s WorkspaceAccessContext fingerprint.
    from app.models import WorkspaceMembership

    db.query(WorkspaceMembership).filter_by(
        workspace_id=tree.id, user_id=other.id
    ).delete()
    db.commit()
    section = _section(db, tree, "Some Section")
    grant = _grant(db, tree, section, other)
    assert grant is not None

    r2 = _search(client, tree, other, q="anna", limit=1, cursor=cursor)
    assert r2.status_code == 400


def test_stale_cursor_after_membership_changes(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    for i in range(3):
        add_member(db, tree, f"m{i}", first_name="Anna", last_name=f"Person{i}")

    r = _search(client, tree, user, q="anna", limit=1)
    cursor = r.json()["next_cursor"]

    add_member(db, tree, "m3", first_name="Anna", last_name="Person3")

    r2 = _search(client, tree, user, q="anna", limit=1, cursor=cursor)
    assert r2.status_code == 409
    assert r2.json()["detail"] == "stale_cursor"


# ---------------------------------------------------------------------------
# Authentication & rate limiting
# ---------------------------------------------------------------------------


def test_anonymous_callers_are_rejected(db, client):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m0", first_name="Anna", last_name="Bauer")

    r = client.get(f"{API}/workspaces/{tree.id}/search", params={"q": "anna"})
    assert r.status_code == 401


def test_caller_is_rate_limited_after_the_budget(db, client, monkeypatch):
    from app.core.rate_limit import search_rate_limiter

    monkeypatch.setattr(search_rate_limiter, "max_attempts", 2)
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m0", first_name="Anna", last_name="Bauer")

    for _ in range(2):
        assert _search(client, tree, user, q="anna").status_code == 200
    throttled = _search(client, tree, user, q="anna")
    assert throttled.status_code == 429
    assert "Retry-After" in throttled.headers
