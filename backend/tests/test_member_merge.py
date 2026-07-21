"""Tests for the in-place, same-tree member merge (#729)."""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import (
    DocumentMemberLink,
    EventMemberLink,
    GalleryMemberLink,
    Member,
    MemberDisease,
    MemberTaskLink,
    Relation,
    StoryMemberLink,
)
from app.models.activity import ActivityLog
from app.models.content import (
    Document,
    Event,
    GalleryImage,
    MemberTask,
    Story,
)
from app.services.member_merge import (
    compute_member_merge_preview,
    merge_members_in_place,
)
from tests.conftest import API, add_member, auth, make_tree, make_user

# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


def test_preview_reports_camel_case_conflicts_and_transfer_counts(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(
        db, tree, "keep", first_name="Henry", last_name="Miller", gender="m",
        date_of_birth="1920", additional_data="Note A", birthplace="Berlin",
    )
    remove = add_member(
        db, tree, "remove", first_name="Henry", last_name="Miller", gender="m",
        date_of_birth="1920", additional_data="Note B", birthplace="Hamburg",
    )
    db.add(Relation(tree_id=tree.id, from_member_id="child", to_member_id="remove",
                     relation_type="parent"))
    add_member(db, tree, "child", first_name="Child", last_name="Miller")
    db.commit()

    preview = compute_member_merge_preview(db, tree, keep, remove)

    assert preview.pair.match == "exact"
    assert "additionalData" in preview.pair.conflicts
    assert "birthplace" in preview.pair.conflicts
    # snake_case names must not leak through
    assert "additional_data" not in preview.pair.conflicts
    assert preview.transfer.relations == 1


# ---------------------------------------------------------------------------
# Guard rails
# ---------------------------------------------------------------------------


def test_self_merge_rejected(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="A")

    with pytest.raises(HTTPException) as exc:
        merge_members_in_place(db, tree, keep, keep, {})
    assert exc.value.status_code == 400


def test_route_rejects_cross_tree_members(client, db):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")
    add_member(db, tree_a, "keep", first_name="A")
    add_member(db, tree_b, "remove", first_name="B")

    resp = client.post(
        f"{API}/trees/{tree_a.id}/members/merge",
        json={"keep_id": "keep", "remove_id": "remove", "fields": {}},
        headers=auth(user),
    )
    assert resp.status_code == 404


def test_merge_creates_cycle_is_rejected(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    # remove is keep's grandparent via mid (keep's parent is mid, mid's parent
    # is remove) — an entirely ordinary, acyclic ancestor chain on its own.
    # But merging keep and remove asserts they are the *same person*, so
    # folding remove's edges onto keep turns "mid's parent is remove" into
    # "mid's parent is keep" — combined with "keep's parent is mid", keep
    # would become its own grandparent.
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    add_member(db, tree, "mid", first_name="Mid")
    db.add(Relation(tree_id=tree.id, from_member_id="keep", to_member_id="mid",
                     relation_type="parent"))
    db.add(Relation(tree_id=tree.id, from_member_id="mid", to_member_id="remove",
                     relation_type="parent"))
    db.commit()

    with pytest.raises(HTTPException) as exc:
        merge_members_in_place(db, tree, keep, remove, {})
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# Relations
# ---------------------------------------------------------------------------


def test_relation_repointed_onto_keep(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    add_member(db, tree, "child", first_name="Child")
    db.add(Relation(tree_id=tree.id, from_member_id="child", to_member_id="remove",
                     relation_type="parent"))
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    relations = db.scalars(select(Relation).where(Relation.tree_id == tree.id)).all()
    assert len(relations) == 1
    assert relations[0].from_member_id == "child"
    assert relations[0].to_member_id == "keep"


def test_duplicate_relation_is_dropped_not_an_integrity_error(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    add_member(db, tree, "child", first_name="Child")
    db.add(Relation(tree_id=tree.id, from_member_id="child", to_member_id="keep",
                     relation_type="parent"))
    db.add(Relation(tree_id=tree.id, from_member_id="child", to_member_id="remove",
                     relation_type="parent"))
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    relations = db.scalars(select(Relation).where(Relation.tree_id == tree.id)).all()
    assert len(relations) == 1
    assert relations[0].to_member_id == "keep"


def test_self_relation_is_dropped(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    db.add(Relation(tree_id=tree.id, from_member_id="remove", to_member_id="keep",
                     relation_type="partner"))
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    relations = db.scalars(select(Relation).where(Relation.tree_id == tree.id)).all()
    assert relations == []


# ---------------------------------------------------------------------------
# Content links
# ---------------------------------------------------------------------------


def test_event_link_transferred(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    event = Event(id="e1", tree_id=tree.id, event_type="birth", date="1920",
                  created_at="2024-01-01T00:00:00Z")
    db.add(event)
    db.add(EventMemberLink(event_id="e1", member_id="remove"))
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    links = db.scalars(select(EventMemberLink)).all()
    assert len(links) == 1
    assert links[0].member_id == "keep"


def test_event_link_duplicate_dropped(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    event = Event(id="e1", tree_id=tree.id, event_type="birth", date="1920",
                  created_at="2024-01-01T00:00:00Z")
    db.add(event)
    db.add(EventMemberLink(event_id="e1", member_id="keep"))
    db.add(EventMemberLink(event_id="e1", member_id="remove"))
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    links = db.scalars(select(EventMemberLink)).all()
    assert len(links) == 1


def test_story_link_transferred(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    db.add(Story(id="s1", tree_id=tree.id, title="Story", created_at="x",
                 updated_at="x"))
    db.add(StoryMemberLink(story_id="s1", member_id="remove"))
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    links = db.scalars(select(StoryMemberLink)).all()
    assert len(links) == 1 and links[0].member_id == "keep"


def test_gallery_link_transferred_with_region(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    db.add(GalleryImage(id="g1", tree_id=tree.id))
    db.add(GalleryMemberLink(gallery_image_id="g1", member_id="remove",
                              x=0.1, y=0.2, w=0.3, h=0.4))
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    links = db.scalars(select(GalleryMemberLink)).all()
    assert len(links) == 1
    assert links[0].member_id == "keep"
    assert links[0].x == 0.1 and links[0].h == 0.4


def test_document_link_transferred(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    db.add(Document(id="d1", tree_id=tree.id, title="Doc", created_at="x",
                     updated_at="x"))
    db.add(DocumentMemberLink(document_id="d1", member_id="remove"))
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    links = db.scalars(select(DocumentMemberLink)).all()
    assert len(links) == 1 and links[0].member_id == "keep"


def test_task_link_transferred(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    db.add(MemberTask(id="t1", tree_id=tree.id, title="Task", created_at="x"))
    db.add(MemberTaskLink(task_id="t1", member_id="remove"))
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    links = db.scalars(select(MemberTaskLink)).all()
    assert len(links) == 1 and links[0].member_id == "keep"


def test_disease_transferred_and_deduped_by_name(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    db.add(MemberDisease(id="dis1", tree_id=tree.id, member_id="keep",
                          name="Diabetes", carrier_status="affected"))
    db.add(MemberDisease(id="dis2", tree_id=tree.id, member_id="remove",
                          name="diabetes", carrier_status="affected"))
    db.add(MemberDisease(id="dis3", tree_id=tree.id, member_id="remove",
                          name="Asthma", carrier_status="carrier"))
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    diseases = db.scalars(select(MemberDisease)).all()
    assert len(diseases) == 2
    assert all(d.member_id == "keep" for d in diseases)
    names = {d.name.lower() for d in diseases}
    assert names == {"diabetes", "asthma"}


# ---------------------------------------------------------------------------
# Field resolution
# ---------------------------------------------------------------------------


def test_field_choice_b_adopts_remove_value(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep", date_of_birth="1920")
    remove = add_member(db, tree, "remove", first_name="Remove", date_of_birth="1921")

    merge_members_in_place(db, tree, keep, remove, {"dateOfBirth": "b"})
    db.commit()

    assert keep.date_of_birth == "1921"


def test_field_choice_combine_unions_additional_data(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep", additional_data="Note A")
    remove = add_member(db, tree, "remove", first_name="Remove", additional_data="Note B")

    merge_members_in_place(db, tree, keep, remove, {"additionalData": "combine"})
    db.commit()

    assert "Note A" in keep.additional_data
    assert "Note B" in keep.additional_data


# ---------------------------------------------------------------------------
# Activity log
# ---------------------------------------------------------------------------


def test_merge_route_records_rich_activity_payload(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    add_member(db, tree, "keep", first_name="Keep", last_name="Person")
    add_member(db, tree, "remove", first_name="Remove", last_name="Person")

    resp = client.post(
        f"{API}/trees/{tree.id}/members/merge",
        json={"keep_id": "keep", "remove_id": "remove", "fields": {}},
        headers=auth(user),
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == "keep"

    assert db.get(Member, "remove") is None

    row = db.scalars(
        select(ActivityLog)
        .where(ActivityLog.tree_id == tree.id)
        .order_by(ActivityLog.id.desc())
    ).first()
    details = json.loads(row.details)
    merge_details = details["merge"]
    assert merge_details["keep_id"] == "keep"
    assert merge_details["removed"]["member"]["id"] == "remove"
    assert "keep_before" in merge_details
    assert "field_choices" in merge_details


# ---------------------------------------------------------------------------
# Tree-in-tree bridge handling
# ---------------------------------------------------------------------------


def test_bridge_link_inherited_onto_keep_and_logged_in_other_tree(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    other = make_tree(db, user, "Other")
    add_member(db, tree, "keep", first_name="Keep", last_name="Person")
    remove = add_member(db, tree, "remove", first_name="Remove", last_name="Person")
    counterpart = add_member(
        db, other, "counterpart", first_name="Remove", last_name="Person",
    )
    # Wire the bridge after both rows exist — linked_member_id is a real FK.
    remove.linked_tree_id = other.id
    remove.linked_member_id = "counterpart"
    counterpart.linked_tree_id = tree.id
    counterpart.linked_member_id = "remove"
    db.commit()

    resp = client.post(
        f"{API}/trees/{tree.id}/members/merge",
        json={"keep_id": "keep", "remove_id": "remove", "fields": {}},
        headers=auth(user),
    )
    assert resp.status_code == 200

    # The merge ran through the client's own session (a different connection
    # than this test's `db`); `keep`/`counterpart` above are held via strong
    # refs, so without this the identity map would serve stale pre-merge
    # state instead of re-querying.
    db.expire_all()
    keep = db.get(Member, "keep")
    assert keep.linked_tree_id == other.id
    assert keep.linked_member_id == "counterpart"
    counterpart = db.get(Member, "counterpart")
    assert counterpart.linked_tree_id == tree.id
    assert counterpart.linked_member_id == "keep"

    row = db.scalars(
        select(ActivityLog)
        .where(ActivityLog.tree_id == other.id)
        .order_by(ActivityLog.id.desc())
    ).first()
    assert row is not None
    assert row.target_id == "counterpart"
    bridge_details = json.loads(row.details)
    assert bridge_details["after"] == {
        "linked_tree_id": tree.id,
        "linked_member_id": "keep",
    }


def test_bridge_link_dissolved_when_keep_already_linked(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    other_a = make_tree(db, user, "OtherA")
    other_b = make_tree(db, user, "OtherB")
    keep = add_member(db, tree, "keep", first_name="Keep", last_name="Person")
    counterpart_a = add_member(
        db, other_a, "counterpart_a", first_name="Keep", last_name="Person",
    )
    remove = add_member(db, tree, "remove", first_name="Remove", last_name="Person")
    counterpart_b = add_member(
        db, other_b, "counterpart_b", first_name="Remove", last_name="Person",
    )
    # Wire both bridges after every row exists — linked_member_id is a real FK.
    keep.linked_tree_id = other_a.id
    keep.linked_member_id = "counterpart_a"
    counterpart_a.linked_tree_id = tree.id
    counterpart_a.linked_member_id = "keep"
    remove.linked_tree_id = other_b.id
    remove.linked_member_id = "counterpart_b"
    counterpart_b.linked_tree_id = tree.id
    counterpart_b.linked_member_id = "remove"
    db.commit()

    resp = client.post(
        f"{API}/trees/{tree.id}/members/merge",
        json={"keep_id": "keep", "remove_id": "remove", "fields": {}},
        headers=auth(user),
    )
    assert resp.status_code == 200

    db.expire_all()  # see comment in the "inherited" test above
    keep = db.get(Member, "keep")
    # keep's own bridge is untouched
    assert keep.linked_tree_id == other_a.id
    assert keep.linked_member_id == "counterpart_a"
    # remove's counterpart is dissolved, not deleted
    counterpart_b = db.get(Member, "counterpart_b")
    assert counterpart_b.linked_tree_id is None
    assert counterpart_b.linked_member_id is None

    row = db.scalars(
        select(ActivityLog)
        .where(ActivityLog.tree_id == other_b.id)
        .order_by(ActivityLog.id.desc())
    ).first()
    assert row is not None
    assert row.target_id == "counterpart_b"
    bridge_details = json.loads(row.details)
    assert bridge_details["after"] == {
        "linked_tree_id": None,
        "linked_member_id": None,
    }
