"""Sub-tree extraction (#535): the selected branch relocates into a new tree
linked through the root, which stays behind as the bridge person.

Extraction is always a linked move (there is no more independent-copy mode).
Direction is one of "whole_family" (default), "descendants" or "ancestors".
"""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.config import settings
from app.db.base import utcnow_iso
from app.models import (
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Member,
    MemberDisease,
    Relation,
    Story,
    StoryAttachment,
    StoryMemberLink,
    Tree,
)
from app.schemas.extract import SubtreeExtractRequest
from app.services import feature_service
from app.services.extract import compute_subtree_preview, extract_subtree
from app.services.storage import MEDIA_URL_PREFIX
from tests.conftest import API, add_member, auth, make_tree, make_user, share


@pytest.fixture()
def media_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return settings.media_root


def add_relation(db, tree, from_id, to_id, rel_type="parent"):
    db.add(
        Relation(
            tree_id=tree.id,
            from_member_id=from_id,
            to_member_id=to_id,
            relation_type=rel_type,
        )
    )
    db.commit()


def req(**kw) -> SubtreeExtractRequest:
    defaults = {
        "name": "Moved branch",
        "source_tree_id": "",
        "root_member_id": "",
        "direction": "descendants",
        "depth": None,
        "include_partners": False,
    }
    defaults.update(kw)
    return SubtreeExtractRequest(**defaults)


def members_of(db, tree):
    return db.query(Member).filter(Member.tree_id == tree.id).all()


def relations_of(db, tree):
    return db.query(Relation).filter(Relation.tree_id == tree.id).all()


def make_family(db, user):
    """root -> c1 -> gc1, root -> c2, plus 'aunt' (partner of c1, stays)."""
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    add_member(db, tree, "c1")
    add_member(db, tree, "c2")
    add_member(db, tree, "gc1")
    add_member(db, tree, "aunt")
    add_relation(db, tree, "c1", "root")
    add_relation(db, tree, "c2", "root")
    add_relation(db, tree, "gc1", "c1")
    add_relation(db, tree, "c1", "aunt", "partner")
    return tree


# ---------------------------------------------------------------------------
# Core move behaviour
# ---------------------------------------------------------------------------

def test_move_descendants_root_stays_and_bridge_is_wired(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)

    new_tree = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="root")
    )

    # Root + aunt stay in the source; the branch moved with stable ids.
    src_ids = {m.id for m in members_of(db, tree)}
    assert src_ids == {"root", "aunt"}
    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"c1", "c2", "gc1"} <= moved_ids
    assert len(moved_ids) == 4  # + the bridge counterpart

    # Bridge wired both ways.
    root = db.get(Member, "root")
    assert root.linked_tree_id == new_tree.id
    assert root.is_collapsed is False
    counterpart = db.get(Member, root.linked_member_id)
    assert counterpart.tree_id == new_tree.id
    assert counterpart.linked_tree_id == tree.id
    assert counterpart.linked_member_id == "root"
    assert counterpart.position_x == 0
    assert counterpart.position_y == 0
    assert counterpart.is_collapsed is False


def test_move_relations_repointed_severed_and_kept(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)

    new_tree = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="root")
    )
    root = db.get(Member, "root")

    new_rels = {
        (r.from_member_id, r.to_member_id, r.relation_type)
        for r in relations_of(db, new_tree)
    }
    # Internal relation kept as-is; root relations bridged to the counterpart.
    assert ("gc1", "c1", "parent") in new_rels
    assert ("c1", root.linked_member_id, "parent") in new_rels
    assert ("c2", root.linked_member_id, "parent") in new_rels
    # The c1<->aunt partner relation crossed the cut: severed everywhere.
    assert len(new_rels) == 3
    assert relations_of(db, tree) == []


def test_move_relations_among_staying_members_untouched(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)
    add_member(db, tree, "uncle")
    add_relation(db, tree, "aunt", "uncle", "partner")

    extract_subtree(db, user, req(source_tree_id=tree.id, root_member_id="root"))

    remaining = {
        (r.from_member_id, r.to_member_id) for r in relations_of(db, tree)
    }
    assert remaining == {("aunt", "uncle")}


def test_move_diseases_follow_their_member(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)
    db.add(
        MemberDisease(
            id="d-moved", tree_id=tree.id, member_id="c1",
            name="Condition", carrier_status="affected",
        )
    )
    db.add(
        MemberDisease(
            id="d-stays", tree_id=tree.id, member_id="root",
            name="Condition", carrier_status="carrier",
        )
    )
    db.commit()

    new_tree = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="root")
    )

    assert db.get(MemberDisease, "d-moved").tree_id == new_tree.id
    assert db.get(MemberDisease, "d-stays").tree_id == tree.id


def test_move_wholly_linked_content_moves_mixed_content_stays(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)
    now = utcnow_iso()

    # Gallery: one image only on moved members, one mixed (root + c1).
    db.add(GalleryImage(id="img-moved", tree_id=tree.id, title="moved"))
    db.add(GalleryImage(id="img-mixed", tree_id=tree.id, title="mixed"))
    db.add(GalleryImage(id="img-unlinked", tree_id=tree.id, title="unlinked"))
    db.add(GalleryMemberLink(gallery_image_id="img-moved", member_id="c1"))
    db.add(GalleryMemberLink(gallery_image_id="img-moved", member_id="gc1"))
    db.add(GalleryMemberLink(gallery_image_id="img-mixed", member_id="root"))
    db.add(GalleryMemberLink(gallery_image_id="img-mixed", member_id="c1"))
    # Event on a moved member only.
    db.add(
        Event(id="ev-moved", tree_id=tree.id, event_type="birth",
              date="2000-01-01", created_at=now)
    )
    db.add(EventMemberLink(event_id="ev-moved", member_id="c2"))
    # Story linked to a moved member and a staying (non-root) member.
    db.add(
        Story(id="st-mixed", tree_id=tree.id, title="Mixed",
              created_at=now, updated_at=now)
    )
    db.add(StoryMemberLink(story_id="st-mixed", member_id="c1"))
    db.add(StoryMemberLink(story_id="st-mixed", member_id="aunt"))
    db.commit()

    new_tree = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="root")
    )

    assert db.get(GalleryImage, "img-moved").tree_id == new_tree.id
    assert db.get(GalleryImage, "img-mixed").tree_id == tree.id
    assert db.get(GalleryImage, "img-unlinked").tree_id == tree.id
    # Moved image keeps both links; the mixed image drops its link to c1.
    assert db.query(GalleryMemberLink).filter_by(
        gallery_image_id="img-moved").count() == 2
    mixed_links = db.query(GalleryMemberLink).filter_by(
        gallery_image_id="img-mixed").all()
    assert [ln.member_id for ln in mixed_links] == ["root"]

    assert db.get(Event, "ev-moved").tree_id == new_tree.id
    assert db.query(EventMemberLink).filter_by(event_id="ev-moved").count() == 1

    assert db.get(Story, "st-mixed").tree_id == tree.id
    story_links = db.query(StoryMemberLink).filter_by(story_id="st-mixed").all()
    assert [ln.member_id for ln in story_links] == ["aunt"]


def test_move_media_files_relocate_on_disk(db, media_root):
    user = make_user(db, "alice")
    tree = make_family(db, user)

    src_dir = media_root / tree.id
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "c1.webp").write_bytes(b"c1-photo")
    (src_dir / "root.webp").write_bytes(b"root-photo")
    db.get(Member, "c1").image_data = f"{MEDIA_URL_PREFIX}/{tree.id}/c1.webp"
    db.get(Member, "root").image_data = f"{MEDIA_URL_PREFIX}/{tree.id}/root.webp"
    now = utcnow_iso()
    (src_dir / "story.pdf").write_bytes(b"story-file")
    db.add(
        Story(id="st", tree_id=tree.id, title="S", created_at=now, updated_at=now)
    )
    db.add(StoryMemberLink(story_id="st", member_id="gc1"))
    db.add(
        StoryAttachment(
            id="att", tree_id=tree.id, story_id="st", filename="story.pdf",
            url=f"{MEDIA_URL_PREFIX}/{tree.id}/story.pdf",
            mime_type="application/pdf", size=10, created_at=now,
        )
    )
    db.commit()

    new_tree = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="root")
    )

    # Moved member photo: gone from the source dir, present in the new one.
    c1 = db.get(Member, "c1")
    assert c1.image_data.startswith(f"{MEDIA_URL_PREFIX}/{new_tree.id}/")
    assert not (src_dir / "c1.webp").exists()
    moved_rel = c1.image_data[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / moved_rel).read_bytes() == b"c1-photo"

    # Root keeps its photo; the counterpart got a *copy*.
    root = db.get(Member, "root")
    assert (src_dir / "root.webp").read_bytes() == b"root-photo"
    counterpart = db.get(Member, root.linked_member_id)
    assert counterpart.image_data.startswith(f"{MEDIA_URL_PREFIX}/{new_tree.id}/")
    cp_rel = counterpart.image_data[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / cp_rel).read_bytes() == b"root-photo"

    # Story attachment moved with its story.
    att = db.get(StoryAttachment, "att")
    assert att.tree_id == new_tree.id
    assert att.url.startswith(f"{MEDIA_URL_PREFIX}/{new_tree.id}/")
    assert not (src_dir / "story.pdf").exists()


# ---------------------------------------------------------------------------
# Traversal selection (descendants / ancestors) — ported from the retired
# copy-mode suite; the underlying selection logic (_collect_member_ids) is
# unchanged by the move rework.
# ---------------------------------------------------------------------------

def test_descendants_only(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    # grandparent -> parent -> child -> grandchild
    add_member(db, tree, "gp")
    add_member(db, tree, "p")
    add_member(db, tree, "c")
    add_member(db, tree, "gc")
    add_relation(db, tree, "p", "gp")   # p's parent is gp
    add_relation(db, tree, "c", "p")    # c's parent is p
    add_relation(db, tree, "gc", "c")   # gc's parent is c

    new_tree = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="p")
    )

    # p -> c -> gc moved (root p excluded, counterpart replaces it); gp stays.
    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"c", "gc"} <= moved_ids
    assert "gp" not in moved_ids
    src_ids = {m.id for m in members_of(db, tree)}
    assert src_ids == {"gp", "p"}


def test_ancestors_only(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "gp")
    add_member(db, tree, "p")
    add_member(db, tree, "c")
    add_member(db, tree, "gc")
    add_relation(db, tree, "p", "gp")
    add_relation(db, tree, "c", "p")
    add_relation(db, tree, "gc", "c")

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="c", direction="ancestors"),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"p", "gp"} <= moved_ids
    assert "gc" not in moved_ids


def test_depth_one_stops_at_one_generation(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "p")
    add_member(db, tree, "c")
    add_member(db, tree, "gc")
    add_relation(db, tree, "c", "p")
    add_relation(db, tree, "gc", "c")

    new_tree = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="p", depth=1)
    )

    # p + c moved; gc is 2 generations away and stays out.
    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert "c" in moved_ids
    assert "gc" not in moved_ids


def test_depth_zero_rejected_as_empty_selection(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "p")
    add_member(db, tree, "c")
    add_relation(db, tree, "c", "p")

    # depth=0 selects only the root, which alone can't be moved.
    with pytest.raises(HTTPException) as exc:
        extract_subtree(
            db, user, req(source_tree_id=tree.id, root_member_id="p", depth=0)
        )
    assert exc.value.status_code == 400


def test_partners_included_when_enabled(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "root")
    add_member(db, tree, "child")
    add_member(db, tree, "spouse")  # partner of root, not a descendant
    add_relation(db, tree, "child", "root")          # child's parent is root
    add_relation(db, tree, "root", "spouse", "partner")  # peer relation

    new_tree = extract_subtree(
        db,
        user,
        req(source_tree_id=tree.id, root_member_id="root", include_partners=True),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"child", "spouse"} <= moved_ids


def test_partners_excluded_when_disabled(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "root")
    add_member(db, tree, "child")
    add_member(db, tree, "spouse")
    add_relation(db, tree, "child", "root")
    add_relation(db, tree, "root", "spouse", "partner")

    new_tree = extract_subtree(
        db,
        user,
        req(source_tree_id=tree.id, root_member_id="root", include_partners=False),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert "child" in moved_ids
    assert "spouse" not in moved_ids


def test_relations_to_excluded_members_are_dropped(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    add_member(db, tree, "p")
    add_member(db, tree, "c1")
    add_member(db, tree, "c2")
    add_relation(db, tree, "c1", "p")
    add_relation(db, tree, "c2", "p")

    # Root c1 + ancestors only => c1 + p; c2 excluded/severed.
    new_tree = extract_subtree(
        db,
        user,
        req(source_tree_id=tree.id, root_member_id="c1", direction="ancestors"),
    )

    new_rels = relations_of(db, new_tree)
    assert len(new_rels) == 1  # only c1->p (bridged), not c2->p


# ---------------------------------------------------------------------------
# Whole-family selection (default direction)
# ---------------------------------------------------------------------------

def test_whole_family_moves_everyone_not_in_main_family(db):
    """wife (root) married into the main family: her parents/siblings should
    all move, while the root's husband and children (the main family) stay."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "wife")   # root
    add_member(db, tree, "rh")     # root's husband — main family, stays
    add_member(db, tree, "rk")     # root+rh's kid — main family, stays
    add_member(db, tree, "wp1")    # wife's parent — moves
    add_member(db, tree, "wp2")    # wife's parent — moves
    add_member(db, tree, "wsis")   # wife's sister — moves
    add_relation(db, tree, "wife", "rh", "partner")
    add_relation(db, tree, "rk", "wife", "parent")
    add_relation(db, tree, "rk", "rh", "parent")
    add_relation(db, tree, "wife", "wp1", "parent")
    add_relation(db, tree, "wife", "wp2", "parent")
    add_relation(db, tree, "wsis", "wp1", "parent")
    add_relation(db, tree, "wsis", "wp2", "parent")

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="wife", direction="whole_family"),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"wp1", "wp2", "wsis"} <= moved_ids
    src_ids = {m.id for m in members_of(db, tree)}
    assert src_ids == {"wife", "rh", "rk"}


def test_whole_family_sister_married_into_main_family(db):
    """The documented edge case: wife's sister also married into the main
    family. The sister moves (she's still wife's blood relative), her
    husband stays (he's connected to the main family via his own sibling),
    and their partner + parent-to-kid relations are severed."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "wife")       # root
    add_member(db, tree, "rh")         # root's husband — main family anchor
    add_member(db, tree, "rh_parent")  # rh's parent — main family
    add_member(db, tree, "h")          # sister's husband, rh's sibling — main family
    add_member(db, tree, "k")          # h + sister's kid — main family (via h)
    add_member(db, tree, "wp1")        # wife's parent — moves
    add_member(db, tree, "wp2")        # wife's parent — moves
    add_member(db, tree, "sis")        # wife's sister — moves

    add_relation(db, tree, "wife", "rh", "partner")
    add_relation(db, tree, "rh", "rh_parent", "parent")
    add_relation(db, tree, "h", "rh_parent", "parent")  # h and rh are siblings
    add_relation(db, tree, "k", "h", "parent")

    add_relation(db, tree, "wife", "wp1", "parent")
    add_relation(db, tree, "wife", "wp2", "parent")
    add_relation(db, tree, "sis", "wp1", "parent")
    add_relation(db, tree, "sis", "wp2", "parent")
    add_relation(db, tree, "sis", "h", "partner")
    add_relation(db, tree, "k", "sis", "parent")

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="wife", direction="whole_family"),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"wp1", "wp2", "sis"} <= moved_ids
    assert not {"rh", "rh_parent", "h", "k"} & moved_ids

    src_ids = {m.id for m in members_of(db, tree)}
    assert src_ids == {"wife", "rh", "rh_parent", "h", "k"}

    # Relations entirely among staying members (including root<->rh, since
    # root itself never moves) are untouched; the sis<->h partner relation
    # and both parent-to-k relations crossed the cut (sis moved, h/k
    # stayed) and were severed rather than kept.
    remaining_rels = {
        (r.from_member_id, r.to_member_id, r.relation_type)
        for r in relations_of(db, tree)
    }
    assert remaining_rels == {
        ("wife", "rh", "partner"),
        ("rh", "rh_parent", "parent"),
        ("h", "rh_parent", "parent"),
        ("k", "h", "parent"),
    }
    new_rels = {
        (r.from_member_id, r.to_member_id, r.relation_type)
        for r in relations_of(db, new_tree)
    }
    assert ("sis", "wp1", "parent") in new_rels
    assert ("sis", "wp2", "parent") in new_rels
    assert ("sis", "h", "partner") not in new_rels
    assert ("k", "sis", "parent") not in new_rels


def test_whole_family_no_anchors_moves_everyone_connected(db):
    """Root with no partners/children: the staying set is empty, so
    everything connected to the root moves."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    add_member(db, tree, "p1")
    add_member(db, tree, "p2")
    add_relation(db, tree, "root", "p1", "parent")
    add_relation(db, tree, "root", "p2", "parent")

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="whole_family"),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"p1", "p2"} <= moved_ids
    src_ids = {m.id for m in members_of(db, tree)}
    assert src_ids == {"root"}


def test_whole_family_ignores_depth_and_include_partners(db):
    """depth/include_partners are irrelevant to whole_family and are ignored
    rather than restricting the selection."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    add_member(db, tree, "p1")
    add_member(db, tree, "gp1")
    add_relation(db, tree, "root", "p1", "parent")
    add_relation(db, tree, "p1", "gp1", "parent")

    new_tree = extract_subtree(
        db, user,
        req(
            source_tree_id=tree.id,
            root_member_id="root",
            direction="whole_family",
            depth=1,
            include_partners=False,
        ),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"p1", "gp1"} <= moved_ids


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_direction_both_no_longer_a_valid_value(db):
    """"both" was already rejected server-side pre-#535 rework and is now
    rejected at the schema level too, since only whole_family/descendants/
    ancestors remain."""
    with pytest.raises(ValidationError):
        req(source_tree_id="t", root_member_id="root", direction="both")


def test_direction_both_rejected_by_the_endpoint(client, db):
    user = make_user(db, "alice")
    tree = make_family(db, user)
    res = client.post(
        f"{API}/trees/extract-subtree",
        headers=auth(user),
        json={
            "name": "Moved",
            "source_tree_id": tree.id,
            "root_member_id": "root",
            "direction": "both",
        },
    )
    assert res.status_code == 422


def test_move_requires_ownership(db):
    owner = make_user(db, "alice")
    editor = make_user(db, "bob")
    tree = make_family(db, owner)
    share(db, tree, editor, role="editor")
    with pytest.raises(HTTPException) as exc:
        extract_subtree(db, editor, req(source_tree_id=tree.id, root_member_id="root"))
    assert exc.value.status_code == 403


def test_move_requires_tree_links_feature(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)
    feature_service.set_state(db, "tree_links", "off")
    db.commit()
    try:
        with pytest.raises(HTTPException) as exc:
            extract_subtree(
                db, user, req(source_tree_id=tree.id, root_member_id="root")
            )
        assert exc.value.status_code == 404
    finally:
        feature_service.set_state(db, "tree_links", "on")
        db.commit()


def test_move_rejects_already_linked_root(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)
    other = make_tree(db, user, "Other")
    db.get(Member, "root").linked_tree_id = other.id
    db.commit()
    with pytest.raises(HTTPException) as exc:
        extract_subtree(db, user, req(source_tree_id=tree.id, root_member_id="root"))
    assert exc.value.status_code == 409


def test_move_rejects_empty_selection(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "lonely")
    with pytest.raises(HTTPException) as exc:
        extract_subtree(db, user, req(source_tree_id=tree.id, root_member_id="lonely"))
    assert exc.value.status_code == 400


def test_move_endpoint_validates_before_creating_a_job(client, db):
    """Precondition failures (here: an already-linked root) surface as 4xx
    from the endpoint synchronously, not as a failed background job."""
    user = make_user(db, "alice")
    tree = make_family(db, user)
    other = make_tree(db, user, "Other")
    db.get(Member, "root").linked_tree_id = other.id
    db.commit()
    res = client.post(
        f"{API}/trees/extract-subtree",
        headers=auth(user),
        json={
            "name": "Moved",
            "source_tree_id": tree.id,
            "root_member_id": "root",
            "direction": "whole_family",
        },
    )
    assert res.status_code == 409


def test_requires_accessible_source(db):
    owner = make_user(db, "owner")
    stranger = make_user(db, "mallory")
    private = make_tree(db, owner)
    add_member(db, private, "m1")

    with pytest.raises(HTTPException) as exc:
        extract_subtree(
            db, stranger, req(source_tree_id=private.id, root_member_id="m1")
        )
    assert exc.value.status_code == 404


def test_foreign_root_member_raises(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1")

    with pytest.raises(HTTPException) as exc:
        extract_subtree(
            db, user, req(source_tree_id=tree.id, root_member_id="does-not-exist")
        )
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def test_move_preview_counts_and_writes_nothing(db, media_root):
    user = make_user(db, "alice")
    tree = make_family(db, user)
    src_dir = media_root / tree.id
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "c1.webp").write_bytes(b"12345")
    db.get(Member, "c1").image_data = f"{MEDIA_URL_PREFIX}/{tree.id}/c1.webp"
    db.commit()

    trees_before = db.query(Tree).count()
    preview = compute_subtree_preview(
        db, user, req(source_tree_id=tree.id, root_member_id="root")
    )

    assert preview.member_count == 3  # c1, c2, gc1 — root excluded
    assert preview.relation_count == 3  # gc1->c1 kept + two bridged to root
    assert preview.severed_relation_count == 1  # c1<->aunt
    assert preview.media_bytes == 5

    # Nothing written: no new tree, members and relations untouched, file kept.
    assert db.query(Tree).count() == trees_before
    assert len(members_of(db, tree)) == 5
    assert len(relations_of(db, tree)) == 4
    assert (src_dir / "c1.webp").exists()
    assert db.get(Member, "root").linked_tree_id is None


def test_move_preview_enforces_ownership(db):
    owner = make_user(db, "alice")
    editor = make_user(db, "bob")
    tree = make_family(db, owner)
    share(db, tree, editor, role="editor")
    with pytest.raises(HTTPException) as exc:
        compute_subtree_preview(
            db, editor, req(source_tree_id=tree.id, root_member_id="root")
        )
    assert exc.value.status_code == 403


def test_whole_family_preview_matches_extraction(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "wife")
    add_member(db, tree, "rh")
    add_member(db, tree, "wp1")
    add_relation(db, tree, "wife", "rh", "partner")
    add_relation(db, tree, "wife", "wp1", "parent")

    preview = compute_subtree_preview(
        db, user,
        req(source_tree_id=tree.id, root_member_id="wife", direction="whole_family"),
    )
    assert preview.member_count == 1  # wp1
    assert preview.relation_count == 1  # wife<->wp1 bridged
    assert preview.severed_relation_count == 0


# ---------------------------------------------------------------------------
# Bridge survives deletion of the linking person (#535 point C)
# ---------------------------------------------------------------------------

def test_subtree_survives_deletion_of_bridge_member(db):
    """Deleting the bridge member from the source tree must not touch the
    linked tree: the member FK is ON DELETE SET NULL, and the linked tree
    itself is untouched because nothing cascades from a member delete into
    another tree."""
    from app.api.routes.members import delete_member

    user = make_user(db, "alice")
    tree = make_family(db, user)

    new_tree = extract_subtree(
        db, user, req(source_tree_id=tree.id, root_member_id="root")
    )
    root = db.get(Member, "root")
    counterpart_id = root.linked_member_id
    assert counterpart_id is not None

    # Delete the bridge member through the route/service layer (writable-tree
    # dependency already resolved to `tree` for the owning user).
    delete_member(member_id="root", tree=tree, user=user, db=db)
    db.commit()

    # The bridge member itself is gone from the source tree.
    assert db.get(Member, "root") is None

    # The linked tree and all of its (former-branch) members still exist.
    assert db.get(Tree, new_tree.id) is not None
    linked_ids = {m.id for m in members_of(db, new_tree)}
    assert {"c1", "c2", "gc1", counterpart_id} <= linked_ids

    # The counterpart's member-level link degrades to NULL (ON DELETE SET
    # NULL on Member.linked_member_id); the tree-level link is unaffected
    # because linked_tree_id points at the source *tree*, which still exists.
    counterpart = db.get(Member, counterpart_id)
    assert counterpart.linked_member_id is None
    assert counterpart.linked_tree_id == tree.id
