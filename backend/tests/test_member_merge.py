"""Tests for the in-place, same-tree member merge (#729)."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.core.exceptions import DomainError
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
from app.services.members.member_merge import (
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
        db,
        tree,
        "keep",
        first_name="Henry",
        last_name="Miller",
        gender="m",
        date_of_birth="1920",
        additional_data="Note A",
        birthplace="Berlin",
    )
    remove = add_member(
        db,
        tree,
        "remove",
        first_name="Henry",
        last_name="Miller",
        gender="m",
        date_of_birth="1920",
        additional_data="Note B",
        birthplace="Hamburg",
    )
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="child",
            to_member_id="remove",
            relation_type="parent",
        )
    )
    add_member(db, tree, "child", first_name="Child", last_name="Miller")
    db.commit()

    preview = compute_member_merge_preview(db, tree, keep, remove)

    assert preview.pair.match == "exact"
    assert "additionalData" in preview.pair.conflicts
    assert "birthplace" in preview.pair.conflicts
    # snake_case names must not leak through
    assert "additional_data" not in preview.pair.conflicts
    assert preview.transfer.relations == 1
    assert preview.would_create_cycle is False


def test_preview_transfer_counts_match_what_actually_transfers(db):
    """Duplicate relations/diseases the merge would drop must not be counted
    as if they would transfer (#812)."""
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    add_member(db, tree, "child", first_name="Child")

    # keep already has this relation — remove's copy is a duplicate.
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="child",
            to_member_id="keep",
            relation_type="parent",
        )
    )
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="child",
            to_member_id="remove",
            relation_type="parent",
        )
    )
    # Becomes a self-relation once both ends fold onto keep.
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="remove",
            to_member_id="keep",
            relation_type="partner",
        )
    )

    db.add(
        MemberDisease(
            id="d1",
            workspace_id=tree.id,
            member_id="keep",
            name="Diabetes",
            carrier_status="affected",
        )
    )
    db.add(
        MemberDisease(
            id="d2",
            workspace_id=tree.id,
            member_id="remove",
            name="diabetes",
            carrier_status="affected",
        )
    )
    db.add(
        MemberDisease(
            id="d3",
            workspace_id=tree.id,
            member_id="remove",
            name="Asthma",
            carrier_status="carrier",
        )
    )
    db.commit()

    preview = compute_member_merge_preview(db, tree, keep, remove)
    assert preview.transfer.relations == 0
    assert preview.transfer.diseases == 1

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    relations = db.scalars(select(Relation).where(Relation.workspace_id == tree.id)).all()
    assert len(relations) == 1
    diseases = db.scalars(select(MemberDisease)).all()
    assert len(diseases) == 2


def test_preview_excludes_redundant_vital_mirror_event_from_transfer_count(db):
    """When both members already have a birth mirror event, the merge's own
    dedup collapses them to one — the preview must not promise a transfer
    that never actually lands (#812)."""
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep", date_of_birth="1920")
    remove = add_member(db, tree, "remove", first_name="Remove", date_of_birth="1921")
    db.add(
        Event(
            id="keep-birth",
            workspace_id=tree.id,
            event_type="birth",
            date="1920",
            created_at="2024-01-01T00:00:00Z",
        )
    )
    db.add(
        Event(
            id="remove-birth",
            workspace_id=tree.id,
            event_type="birth",
            date="1921",
            created_at="2024-01-01T00:00:00Z",
        )
    )
    db.add(EventMemberLink(event_id="keep-birth", member_id="keep"))
    db.add(EventMemberLink(event_id="remove-birth", member_id="remove"))
    db.commit()

    preview = compute_member_merge_preview(db, tree, keep, remove)
    assert preview.transfer.events == 0


def test_preview_flags_would_create_cycle(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    add_member(db, tree, "mid", first_name="Mid")
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="keep",
            to_member_id="mid",
            relation_type="parent",
        )
    )
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="mid",
            to_member_id="remove",
            relation_type="parent",
        )
    )
    db.commit()

    preview = compute_member_merge_preview(db, tree, keep, remove)
    assert preview.would_create_cycle is True


def test_preview_does_not_flag_unrelated_cycle(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    add_member(db, tree, "x", first_name="X")
    add_member(db, tree, "y", first_name="Y")
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="x",
            to_member_id="y",
            relation_type="parent",
        )
    )
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="y",
            to_member_id="x",
            relation_type="parent",
        )
    )
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    db.commit()

    preview = compute_member_merge_preview(db, tree, keep, remove)
    assert preview.would_create_cycle is False


# ---------------------------------------------------------------------------
# Guard rails
# ---------------------------------------------------------------------------


def test_self_merge_rejected(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="A")

    with pytest.raises(DomainError) as exc:
        merge_members_in_place(db, tree, keep, keep, {})
    assert exc.value.status_code == 400


def test_route_rejects_cross_tree_members(client, db):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")
    add_member(db, tree_a, "keep", first_name="A")
    add_member(db, tree_b, "remove", first_name="B")

    resp = client.post(
        f"{API}/workspaces/{tree_a.id}/members/merge",
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
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="keep",
            to_member_id="mid",
            relation_type="parent",
        )
    )
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="mid",
            to_member_id="remove",
            relation_type="parent",
        )
    )
    db.commit()

    with pytest.raises(DomainError) as exc:
        merge_members_in_place(db, tree, keep, remove, {})
    assert exc.value.status_code == 400


def test_pre_existing_unrelated_cycle_does_not_block_merge(db):
    """A cycle elsewhere in the tree, uninvolved with keep or remove, must
    not disable merging — relation creation has no cycle guard and the
    quality report treats such cycles as pre-existing/informational, so this
    merge's own guard must be scoped to cycles it would actually create
    (#812)."""
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    add_member(db, tree, "x", first_name="X")
    add_member(db, tree, "y", first_name="Y")
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="x",
            to_member_id="y",
            relation_type="parent",
        )
    )
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="y",
            to_member_id="x",
            relation_type="parent",
        )
    )
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    assert db.get(Member, "remove") is None


# ---------------------------------------------------------------------------
# Relations
# ---------------------------------------------------------------------------


def test_relation_repointed_onto_keep(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    add_member(db, tree, "child", first_name="Child")
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="child",
            to_member_id="remove",
            relation_type="parent",
        )
    )
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    relations = db.scalars(select(Relation).where(Relation.workspace_id == tree.id)).all()
    assert len(relations) == 1
    assert relations[0].from_member_id == "child"
    assert relations[0].to_member_id == "keep"


def test_duplicate_relation_is_dropped_not_an_integrity_error(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    add_member(db, tree, "child", first_name="Child")
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="child",
            to_member_id="keep",
            relation_type="parent",
        )
    )
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="child",
            to_member_id="remove",
            relation_type="parent",
        )
    )
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    relations = db.scalars(select(Relation).where(Relation.workspace_id == tree.id)).all()
    assert len(relations) == 1
    assert relations[0].to_member_id == "keep"


def test_self_relation_is_dropped(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    db.add(
        Relation(
            workspace_id=tree.id,
            from_member_id="remove",
            to_member_id="keep",
            relation_type="partner",
        )
    )
    db.commit()

    merge_members_in_place(db, tree, keep, remove, {})
    db.commit()

    relations = db.scalars(select(Relation).where(Relation.workspace_id == tree.id)).all()
    assert relations == []


# ---------------------------------------------------------------------------
# Content links
# ---------------------------------------------------------------------------


def test_event_link_transferred(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    keep = add_member(db, tree, "keep", first_name="Keep")
    remove = add_member(db, tree, "remove", first_name="Remove")
    event = Event(
        id="e1",
        workspace_id=tree.id,
        event_type="birth",
        date="1920",
        created_at="2024-01-01T00:00:00Z",
    )
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
    event = Event(
        id="e1",
        workspace_id=tree.id,
        event_type="birth",
        date="1920",
        created_at="2024-01-01T00:00:00Z",
    )
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
    db.add(
        Story(
            id="s1", workspace_id=tree.id, title="Story", created_at="x", updated_at="x"
        )
    )
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
    db.add(GalleryImage(id="g1", workspace_id=tree.id))
    db.add(
        GalleryMemberLink(
            gallery_image_id="g1", member_id="remove", x=0.1, y=0.2, w=0.3, h=0.4
        )
    )
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
    db.add(
        Document(
            id="d1", workspace_id=tree.id, title="Doc", created_at="x", updated_at="x"
        )
    )
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
    db.add(MemberTask(id="t1", workspace_id=tree.id, title="Task", created_at="x"))
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
    db.add(
        MemberDisease(
            id="dis1",
            workspace_id=tree.id,
            member_id="keep",
            name="Diabetes",
            carrier_status="affected",
        )
    )
    db.add(
        MemberDisease(
            id="dis2",
            workspace_id=tree.id,
            member_id="remove",
            name="diabetes",
            carrier_status="affected",
        )
    )
    db.add(
        MemberDisease(
            id="dis3",
            workspace_id=tree.id,
            member_id="remove",
            name="Asthma",
            carrier_status="carrier",
        )
    )
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
        f"{API}/workspaces/{tree.id}/members/merge",
        json={"keep_id": "keep", "remove_id": "remove", "fields": {}},
        headers=auth(user),
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == "keep"

    assert db.get(Member, "remove") is None

    row = db.scalars(
        select(ActivityLog)
        .where(ActivityLog.workspace_id == tree.id)
        .order_by(ActivityLog.id.desc())
    ).first()
    details = json.loads(row.details)
    merge_details = details["merge"]
    assert merge_details["keep_id"] == "keep"
    assert merge_details["removed"]["member"]["id"] == "remove"
    assert "keep_before" in merge_details
    assert "field_choices" in merge_details


# ---------------------------------------------------------------------------
# Vital-event mirror consistency (#812)
# ---------------------------------------------------------------------------


def test_merge_dedupes_duplicate_vital_mirror_events(client, db):
    """Both members having their own birth mirror event is the common
    duplicate case — the merge must not leave keep linked to two."""
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    add_member(db, tree, "keep", first_name="Keep", date_of_birth="1920")
    add_member(db, tree, "remove", first_name="Remove", date_of_birth="1921")
    db.add(
        Event(
            id="keep-birth",
            workspace_id=tree.id,
            event_type="birth",
            date="1920",
            created_at="2024-01-01T00:00:00Z",
        )
    )
    db.add(
        Event(
            id="remove-birth",
            workspace_id=tree.id,
            event_type="birth",
            date="1921",
            created_at="2024-01-01T00:00:00Z",
        )
    )
    db.add(EventMemberLink(event_id="keep-birth", member_id="keep"))
    db.add(EventMemberLink(event_id="remove-birth", member_id="remove"))
    db.commit()

    resp = client.post(
        f"{API}/workspaces/{tree.id}/members/merge",
        json={"keep_id": "keep", "remove_id": "remove", "fields": {}},
        headers=auth(user),
    )
    assert resp.status_code == 200

    events = db.scalars(
        select(Event).where(Event.workspace_id == tree.id, Event.event_type == "birth")
    ).all()
    assert len(events) == 1
    # Default field choice is "a" — keep's own date survives.
    assert events[0].date == "1920"


def test_merge_creates_vital_event_reflecting_resolved_fields(client, db):
    """Field choice 'b' adopting remove's date_of_birth/birthplace must sync
    onto keep's vital-event mirror, same as a plain member edit would."""
    user = make_user(db, "alice")
    tree = make_tree(db, user, "T")
    add_member(db, tree, "keep", first_name="Keep")
    add_member(
        db,
        tree,
        "remove",
        first_name="Remove",
        date_of_birth="1921",
        birthplace="Hamburg",
    )

    resp = client.post(
        f"{API}/workspaces/{tree.id}/members/merge",
        json={
            "keep_id": "keep",
            "remove_id": "remove",
            "fields": {"dateOfBirth": "b", "birthplace": "b"},
        },
        headers=auth(user),
    )
    assert resp.status_code == 200

    event = db.query(Event).filter_by(workspace_id=tree.id, event_type="birth").one()
    assert event.date == "1921"
    assert event.location == "Hamburg"

