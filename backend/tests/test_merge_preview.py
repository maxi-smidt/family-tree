"""Tests for compute_merge_preview and the resolution-aware merge_trees.

Basic no-resolution dedupe behavior is covered by test_merge.py; this file
covers preview computation and explicit MergeResolution handling.
"""

from __future__ import annotations

import pytest

from app.core.exceptions import DomainError
from app.models import Member, Relation
from app.schemas.merge import MergeResolution
from app.services.trees.merge import compute_merge_preview, merge_trees
from tests.conftest import add_member, make_tree, make_user, share

# ---------------------------------------------------------------------------
# Preview helpers
# ---------------------------------------------------------------------------


def test_preview_exact_duplicates(db):
    user = make_user(db, "alice")
    ta = make_tree(db, user, "A")
    tb = make_tree(db, user, "B")

    add_member(db, ta, "a1", first_name="Henry", last_name="Miller", gender="m",
               date_of_birth="1920", additional_data="Note A", birthplace="Berlin")
    add_member(db, tb, "b1", first_name="Henry", last_name="Miller", gender="m",
               date_of_birth="1920", additional_data="Note B", birthplace="Hamburg")

    preview = compute_merge_preview(db, user, ta.id, tb.id)

    assert preview.total_members == 2
    assert preview.merged_count == 1
    assert len(preview.duplicates) == 1
    pair = preview.duplicates[0]
    assert pair.match == "exact"
    assert pair.default_action == "merge"
    assert "additional_data" in pair.conflicts
    assert "birthplace" in pair.conflicts


def test_preview_possible_candidate(db):
    user = make_user(db, "alice")
    ta = make_tree(db, user, "A")
    tb = make_tree(db, user, "B")

    add_member(db, ta, "a1", first_name="Anna", last_name="Schmidt", gender="f",
               date_of_birth="1950")
    # Same name+gender but different birth date → possible
    add_member(db, tb, "b1", first_name="Anna", last_name="Schmidt", gender="f",
               date_of_birth="1951")

    preview = compute_merge_preview(db, user, ta.id, tb.id)

    assert preview.total_members == 2
    assert len(preview.duplicates) == 1
    pair = preview.duplicates[0]
    assert pair.match == "possible"
    assert pair.default_action == "keep_both"
    assert "date_of_birth" in pair.conflicts


def test_preview_no_duplicates(db):
    user = make_user(db, "alice")
    ta = make_tree(db, user, "A")
    tb = make_tree(db, user, "B")

    add_member(db, ta, "a1", first_name="Alice", last_name="Smith", gender="f")
    add_member(db, tb, "b1", first_name="Bob", last_name="Jones", gender="m")

    preview = compute_merge_preview(db, user, ta.id, tb.id)

    assert len(preview.duplicates) == 0
    assert preview.merged_count == 2


def test_preview_single_source_no_duplicates(db):
    user = make_user(db, "alice")
    ta = make_tree(db, user, "A")
    add_member(db, ta, "a1", first_name="Alice", last_name="Smith", gender="f")

    preview = compute_merge_preview(db, user, ta.id, None)

    assert preview.total_members == 1
    assert preview.merged_count == 1
    assert preview.duplicates == []


def test_preview_auth_unreadable_source(db):
    owner = make_user(db, "owner")
    stranger = make_user(db, "stranger")
    ta = make_tree(db, owner, "Private")

    with pytest.raises(DomainError) as exc:
        compute_merge_preview(db, stranger, ta.id, None)
    assert exc.value.status_code == 404


def test_preview_auth_readable_shared_source(db):
    owner = make_user(db, "owner")
    viewer = make_user(db, "viewer")
    ta = make_tree(db, owner, "A")
    tb = make_tree(db, owner, "B")
    share(db, ta, viewer, "viewer")
    share(db, tb, viewer, "viewer")
    add_member(db, ta, "a1", first_name="X", last_name="Y", gender="m")

    # Should not raise
    preview = compute_merge_preview(db, viewer, ta.id, tb.id)
    assert preview.total_members == 1


# ---------------------------------------------------------------------------
# Resolution: field choice "b"
# ---------------------------------------------------------------------------


def test_merge_field_choice_b(db):
    user = make_user(db, "alice")
    ta = make_tree(db, user, "A")
    tb = make_tree(db, user, "B")

    add_member(db, ta, "a1", first_name="Tom", last_name="Doe", gender="m",
               date_of_birth="1930", birthplace="Berlin")
    add_member(db, tb, "b1", first_name="Tom", last_name="Doe", gender="m",
               date_of_birth="1930", birthplace="Hamburg")

    resolutions = [
        MergeResolution(
            member_a_id="a1",
            member_b_id="b1",
            action="merge",
            fields={"birthplace": "b"},
        )
    ]
    merged = merge_trees(db, user, "M", ta.id, tb.id, resolutions)

    members = db.query(Member).filter(Member.tree_id == merged.id).all()
    assert len(members) == 1
    assert members[0].birthplace == "Hamburg"


# ---------------------------------------------------------------------------
# Resolution: "combine" for additionalData
# ---------------------------------------------------------------------------


def test_merge_combine_additional_data(db):
    user = make_user(db, "alice")
    ta = make_tree(db, user, "A")
    tb = make_tree(db, user, "B")

    add_member(db, ta, "a1", first_name="Karl", last_name="Bauer", gender="m",
               date_of_birth="1940", additional_data="Note A")
    add_member(db, tb, "b1", first_name="Karl", last_name="Bauer", gender="m",
               date_of_birth="1940", additional_data="Note B")

    resolutions = [
        MergeResolution(
            member_a_id="a1",
            member_b_id="b1",
            action="merge",
            fields={"additional_data": "combine"},
        )
    ]
    merged = merge_trees(db, user, "M", ta.id, tb.id, resolutions)

    members = db.query(Member).filter(Member.tree_id == merged.id).all()
    assert len(members) == 1
    combined = members[0].additional_data or ""
    assert "Note A" in combined
    assert "Note B" in combined


# ---------------------------------------------------------------------------
# Resolution: keep_both for exact duplicate
# ---------------------------------------------------------------------------


def test_merge_keep_both_exact_duplicate(db):
    user = make_user(db, "alice")
    ta = make_tree(db, user, "A")
    tb = make_tree(db, user, "B")

    add_member(db, ta, "a1", first_name="Eva", last_name="Lang", gender="f",
               date_of_birth="1955")
    # Relations involving a1 in tree A
    add_member(db, ta, "a2", first_name="Max", last_name="Lang", gender="m",
               date_of_birth="1950")
    db.add(Relation(tree_id=ta.id, from_member_id="a1", to_member_id="a2",
                    relation_type="partner"))
    db.commit()

    add_member(db, tb, "b1", first_name="Eva", last_name="Lang", gender="f",
               date_of_birth="1955")

    resolutions = [
        MergeResolution(
            member_a_id="a1",
            member_b_id="b1",
            action="keep_both",
        )
    ]
    merged = merge_trees(db, user, "M", ta.id, tb.id, resolutions)

    members = db.query(Member).filter(Member.tree_id == merged.id).all()
    eva_members = [m for m in members if (m.first_name or "").lower() == "eva"]
    # Both Evas should exist
    assert len(eva_members) == 2

    # Relations from tree A should still be intact
    relations = db.query(Relation).filter(Relation.tree_id == merged.id).all()
    assert len(relations) >= 1


# ---------------------------------------------------------------------------
# Resolution: possible candidate with merge action
# ---------------------------------------------------------------------------


def test_merge_possible_candidate_with_merge_resolution(db):
    user = make_user(db, "alice")
    ta = make_tree(db, user, "A")
    tb = make_tree(db, user, "B")

    add_member(db, ta, "a1", first_name="Lena", last_name="Bauer", gender="f",
               date_of_birth="1960")
    # Same name+gender but different year
    add_member(db, tb, "b1", first_name="Lena", last_name="Bauer", gender="f",
               date_of_birth="1961")

    resolutions = [
        MergeResolution(
            member_a_id="a1",
            member_b_id="b1",
            action="merge",
            fields={"date_of_birth": "b"},
        )
    ]
    merged = merge_trees(db, user, "M", ta.id, tb.id, resolutions)

    members = db.query(Member).filter(Member.tree_id == merged.id).all()
    assert len(members) == 1
    assert members[0].date_of_birth == "1961"
