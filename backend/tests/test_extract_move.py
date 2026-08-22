"""Sub-tree extraction (#535): the selected branch relocates into a new tree
linked through the root, which stays behind as the bridge person.

Extraction is always a linked move (there is no more independent-copy mode).
Direction is one of "direct_family" (default) or "partnership".
"""

import pytest
from pydantic import ValidationError

from app.core.config import settings
from app.core.exceptions import DomainError
from app.db.base import utcnow_iso
from app.models import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    Member,
    MemberDisease,
    Relation,
    Story,
    StoryDocumentLink,
    StoryMemberLink,
    Tree,
)
from app.schemas.extract import SubtreeExtractRequest
from app.services.extract import compute_subtree_preview, extract_subtree
from app.services.storage import MEDIA_URL_PREFIX
from app.services.system import feature_service
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
        "direction": "direct_family",
    }
    defaults.update(kw)
    return SubtreeExtractRequest(**defaults)


def members_of(db, tree):
    return db.query(Member).filter(Member.tree_id == tree.id).all()


def relations_of(db, tree):
    return db.query(Relation).filter(Relation.tree_id == tree.id).all()


def make_family(db, user):
    """root's parent p1; p1's other children c1, c2 (root's siblings); c1's
    child gc1 (root's nephew); c1's partner aunt (one-hop pull); aunt's own
    parent outsider (two hops from c1, so NOT pulled in — stays and gets
    severed).

    Used by the move-mechanics tests with direction "direct_family": moved =
    {p1, c1, c2, gc1, aunt}; root and outsider stay.
    """
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    add_member(db, tree, "p1")
    add_member(db, tree, "c1")
    add_member(db, tree, "c2")
    add_member(db, tree, "gc1")
    add_member(db, tree, "aunt")
    add_member(db, tree, "outsider")
    add_relation(db, tree, "root", "p1", "parent")
    add_relation(db, tree, "c1", "p1", "parent")
    add_relation(db, tree, "c2", "p1", "parent")
    add_relation(db, tree, "gc1", "c1", "parent")
    add_relation(db, tree, "c1", "aunt", "partner")
    add_relation(db, tree, "aunt", "outsider", "parent")
    return tree


def make_canonical_family(db, user):
    """The canonical family used across the direction-specific tests:

    Karl+Rosa -> Jan, Tom
    Emil+Marta -> Anna, Paul
    Paul+Ines partners
    Tom+Anna partners -> Lena, Max
    """
    tree = make_tree(db, user)
    for m in ("karl", "rosa", "jan", "tom", "emil", "marta", "anna", "paul",
              "ines", "lena", "max"):
        add_member(db, tree, m)
    add_relation(db, tree, "jan", "karl", "parent")
    add_relation(db, tree, "jan", "rosa", "parent")
    add_relation(db, tree, "tom", "karl", "parent")
    add_relation(db, tree, "tom", "rosa", "parent")
    add_relation(db, tree, "anna", "emil", "parent")
    add_relation(db, tree, "anna", "marta", "parent")
    add_relation(db, tree, "paul", "emil", "parent")
    add_relation(db, tree, "paul", "marta", "parent")
    add_relation(db, tree, "paul", "ines", "partner")
    add_relation(db, tree, "tom", "anna", "partner")
    add_relation(db, tree, "lena", "tom", "parent")
    add_relation(db, tree, "lena", "anna", "parent")
    add_relation(db, tree, "max", "tom", "parent")
    add_relation(db, tree, "max", "anna", "parent")
    return tree


# ---------------------------------------------------------------------------
# Core move behaviour
# ---------------------------------------------------------------------------

def test_move_root_stays_and_bridge_is_wired(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
    )

    # Root + outsider stay in the source; the branch moved with stable ids.
    src_ids = {m.id for m in members_of(db, tree)}
    assert src_ids == {"root", "outsider"}
    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"p1", "c1", "c2", "gc1", "aunt"} <= moved_ids
    assert len(moved_ids) == 6  # + the bridge counterpart

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


def test_move_zeroes_positions_for_a_fresh_layout(db):
    """Moved members keep their old positions from the source tree by
    default (only tree_id and image_data are otherwise touched); the move
    must zero them out so the new tree opens with an "unarranged" layout
    (matching the bridge counterpart, which is already 0/0) instead of
    stale, holey positions the frontend then auto-arranges on first open."""
    user = make_user(db, "alice")
    tree = make_family(db, user)
    for member_id, x, y in (("p1", 100, 200), ("c1", 300, 400), ("c2", -50, 75)):
        m = db.get(Member, member_id)
        m.position_x = x
        m.position_y = y
    db.commit()

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
    )

    for m in members_of(db, new_tree):
        assert m.position_x == 0
        assert m.position_y == 0


def test_move_relations_repointed_severed_and_kept(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
    )
    root = db.get(Member, "root")

    new_rels = {
        (r.from_member_id, r.to_member_id, r.relation_type)
        for r in relations_of(db, new_tree)
    }
    # Internal relations kept as-is; root's relation to p1 bridged to the counterpart.
    assert ("c1", "p1", "parent") in new_rels
    assert ("c2", "p1", "parent") in new_rels
    assert ("gc1", "c1", "parent") in new_rels
    assert ("c1", "aunt", "partner") in new_rels
    assert (root.linked_member_id, "p1", "parent") in new_rels
    # The aunt<->outsider parent relation crossed the cut: severed everywhere.
    assert len(new_rels) == 5
    assert relations_of(db, tree) == []


def test_move_relations_among_staying_members_untouched(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)
    add_member(db, tree, "other_stayer")
    add_relation(db, tree, "outsider", "other_stayer", "partner")

    extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
    )

    remaining = {
        (r.from_member_id, r.to_member_id) for r in relations_of(db, tree)
    }
    assert remaining == {("outsider", "other_stayer")}


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
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
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
    db.add(StoryMemberLink(story_id="st-mixed", member_id="outsider"))
    db.commit()

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
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
    assert [ln.member_id for ln in story_links] == ["outsider"]


def test_move_document_linked_to_moved_and_staying_member_is_copied(db):
    """A document linked to both a moved member (c1) and a staying member
    (outsider) is copied into the new tree: the moved member's link points at
    the copy, the staying member's link stays on the original, and neither link
    crosses a tree boundary."""
    user = make_user(db, "alice")
    tree = make_family(db, user)
    now = utcnow_iso()
    db.add(
        Document(id="doc", tree_id=tree.id, title="Shared",
                 created_at=now, updated_at=now)
    )
    db.add(
        DocumentFile(id="df", tree_id=tree.id, document_id="doc", kind="link",
                     filename="Rec", url="https://example.com/r", created_at=now)
    )
    db.add(DocumentMemberLink(document_id="doc", member_id="c1"))       # moves
    db.add(DocumentMemberLink(document_id="doc", member_id="outsider"))  # stays
    db.commit()

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
    )

    # Original stays for the staying member's link.
    original = db.get(Document, "doc")
    assert original.tree_id == tree.id
    orig_links = db.query(DocumentMemberLink).filter_by(document_id="doc").all()
    assert [ln.member_id for ln in orig_links] == ["outsider"]

    # A copy was created in the new tree for the moved member's link.
    copies = [
        d for d in db.query(Document).filter(Document.tree_id == new_tree.id).all()
    ]
    assert len(copies) == 1
    copy = copies[0]
    assert copy.id != "doc"
    assert copy.title == "Shared"
    copy_member_links = (
        db.query(DocumentMemberLink).filter_by(document_id=copy.id).all()
    )
    assert [ln.member_id for ln in copy_member_links] == ["c1"]
    # The copied file rode along, in the new tree.
    copy_files = db.query(DocumentFile).filter_by(document_id=copy.id).all()
    assert len(copy_files) == 1
    assert copy_files[0].tree_id == new_tree.id

    # No document_member_link crosses a tree boundary.
    for link in db.query(DocumentMemberLink).all():
        member = db.get(Member, link.member_id)
        doc = db.get(Document, link.document_id)
        assert member.tree_id == doc.tree_id


def test_move_document_linked_only_to_moved_member_is_gc_d(db, media_root):
    """A document linked ONLY to moved members is copied into the new tree and
    its now-orphaned original (with its file row and the on-disk bytes) is
    garbage-collected from the source tree."""
    user = make_user(db, "alice")
    tree = make_family(db, user)
    now = utcnow_iso()

    src_dir = media_root / tree.id
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "orphan.pdf").write_bytes(b"orphan-file")

    db.add(
        Document(id="doc", tree_id=tree.id, title="Only moved",
                 created_at=now, updated_at=now)
    )
    db.add(
        DocumentFile(
            id="df", tree_id=tree.id, document_id="doc", kind="file",
            filename="orphan.pdf",
            url=f"{MEDIA_URL_PREFIX}/{tree.id}/orphan.pdf",
            mime_type="application/pdf", size=11, created_at=now,
        )
    )
    db.add(DocumentMemberLink(document_id="doc", member_id="c1"))  # only moves
    db.commit()

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
    )

    # The orphaned original document, its file row, and the on-disk bytes are gone.
    assert db.get(Document, "doc") is None
    assert db.get(DocumentFile, "df") is None
    assert not (src_dir / "orphan.pdf").exists()

    # A copy lives in the new tree, carrying the file bytes.
    copies = db.query(Document).filter(Document.tree_id == new_tree.id).all()
    assert len(copies) == 1
    copy = copies[0]
    assert copy.title == "Only moved"
    copy_member_links = (
        db.query(DocumentMemberLink).filter_by(document_id=copy.id).all()
    )
    assert [ln.member_id for ln in copy_member_links] == ["c1"]
    copy_files = db.query(DocumentFile).filter_by(document_id=copy.id).all()
    assert len(copy_files) == 1
    cf = copy_files[0]
    assert cf.tree_id == new_tree.id
    cf_rel = cf.url[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / cf_rel).read_bytes() == b"orphan-file"


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
        Document(
            id="doc", tree_id=tree.id, title="S", created_at=now, updated_at=now,
        )
    )
    db.add(
        DocumentFile(
            id="att", tree_id=tree.id, document_id="doc", kind="file",
            filename="story.pdf",
            url=f"{MEDIA_URL_PREFIX}/{tree.id}/story.pdf",
            mime_type="application/pdf", size=10, created_at=now,
        )
    )
    db.add(StoryDocumentLink(story_id="st", document_id="doc"))
    db.commit()

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
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

    # The story moved into the new tree; its linked document is reusable
    # content, so it is COPIED into the new tree (with its file bytes) and the
    # story's link is repointed to the copy — no link crosses a tree boundary.
    story = db.get(Story, "st")
    assert story.tree_id == new_tree.id

    links = db.query(StoryDocumentLink).filter_by(story_id="st").all()
    assert len(links) == 1
    copied_doc_id = links[0].document_id
    assert copied_doc_id != "doc"  # repointed to the copy, not the original
    copied_doc = db.get(Document, copied_doc_id)
    assert copied_doc.tree_id == new_tree.id  # link stays within the new tree

    copied_files = db.query(DocumentFile).filter_by(document_id=copied_doc_id).all()
    assert len(copied_files) == 1
    cf = copied_files[0]
    assert cf.tree_id == new_tree.id
    assert cf.kind == "file"
    assert cf.filename == "story.pdf"
    assert cf.url.startswith(f"{MEDIA_URL_PREFIX}/{new_tree.id}/")
    cf_rel = cf.url[len(MEDIA_URL_PREFIX) + 1 :]
    assert (media_root / cf_rel).read_bytes() == b"story-file"

    # The original document was linked only to the story, which moved in its
    # entirety — it is now orphaned in the source tree, so it (and its file
    # row and on-disk bytes) are garbage-collected rather than left behind.
    assert db.get(Document, "doc") is None
    assert db.get(DocumentFile, "att") is None
    assert not (src_dir / "story.pdf").exists()


# ---------------------------------------------------------------------------
# Direction: direct_family — the root's family of origin
# ---------------------------------------------------------------------------

def test_direct_family_moves_parents_and_their_partners(db):
    """Rooted at Anna: moves Emil, Marta (parents), Paul (sibling) and Ines
    (Paul's partner, one-hop pull). Anna stays as bridge; Lena/Max/Tom/Karl/
    Rosa/Jan stay (unrelated branch)."""
    user = make_user(db, "alice")
    tree = make_canonical_family(db, user)

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="anna", direction="direct_family"),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"emil", "marta", "paul", "ines"} <= moved_ids
    assert len(moved_ids) == 5  # + bridge counterpart

    src_ids = {m.id for m in members_of(db, tree)}
    assert src_ids == {"anna", "lena", "max", "tom", "karl", "rosa", "jan"}

    anna = db.get(Member, "anna")
    counterpart_id = anna.linked_member_id

    new_rels = {
        (r.from_member_id, r.to_member_id, r.relation_type)
        for r in relations_of(db, new_tree)
    }
    # Anna<->Emil/Marta parent relations become bridge relations.
    assert (counterpart_id, "emil", "parent") in new_rels
    assert (counterpart_id, "marta", "parent") in new_rels
    # Paul<->Emil/Marta and Paul<->Ines kept as-is (both endpoints moved).
    assert ("paul", "emil", "parent") in new_rels
    assert ("paul", "marta", "parent") in new_rels
    assert ("paul", "ines", "partner") in new_rels

    # Anna<->Tom partner and Anna<->Lena/Max parent relations survive in the
    # SOURCE tree untouched — they're staying<->root, not crossing the cut.
    src_rels = {
        (r.from_member_id, r.to_member_id, r.relation_type)
        for r in relations_of(db, tree)
    }
    assert ("tom", "anna", "partner") in src_rels
    assert ("lena", "anna", "parent") in src_rels
    assert ("max", "anna", "parent") in src_rels
    # And Tom's own family of origin (Karl/Rosa/Jan) is entirely untouched.
    assert ("jan", "karl", "parent") in src_rels
    assert ("jan", "rosa", "parent") in src_rels
    assert ("tom", "karl", "parent") in src_rels
    assert ("tom", "rosa", "parent") in src_rels
    assert ("lena", "tom", "parent") in src_rels
    assert ("max", "tom", "parent") in src_rels


def test_direct_family_roots_own_children_never_move(db):
    """Even in deeper trees, the root's own descendants (children,
    grandchildren, ...) stay behind — direct_family only goes "up and
    sideways" from the root."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    add_member(db, tree, "parent")
    add_member(db, tree, "child")
    add_member(db, tree, "grandchild")
    add_relation(db, tree, "root", "parent", "parent")
    add_relation(db, tree, "child", "root", "parent")
    add_relation(db, tree, "grandchild", "child", "parent")

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert "parent" in moved_ids
    assert "child" not in moved_ids
    assert "grandchild" not in moved_ids

    src_ids = {m.id for m in members_of(db, tree)}
    assert src_ids == {"root", "child", "grandchild"}


def test_direct_family_no_parents_in_tree_rejected(db):
    """Siblings are only reachable via parents; a root with no parent rows
    has nothing to move under direct_family."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    add_member(db, tree, "child")
    add_relation(db, tree, "child", "root", "parent")

    with pytest.raises(DomainError) as exc:
        extract_subtree(
            db, user,
            req(source_tree_id=tree.id, root_member_id="root",
                direction="direct_family"),
        )
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# Direction: partnership — the root's partner(s) and their world
# ---------------------------------------------------------------------------

def test_partnership_moves_partner_side_and_shared_children(db):
    """Rooted at Tom: moves Anna, Emil, Marta, Paul, Ines, Lena, Max. Tom
    stays as bridge; Karl/Rosa/Jan (Tom's own family of origin) stay."""
    user = make_user(db, "alice")
    tree = make_canonical_family(db, user)

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="tom", direction="partnership"),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"anna", "emil", "marta", "paul", "ines", "lena", "max"} <= moved_ids
    assert len(moved_ids) == 8  # + bridge counterpart

    src_ids = {m.id for m in members_of(db, tree)}
    assert src_ids == {"tom", "karl", "rosa", "jan"}

    tom = db.get(Member, "tom")
    counterpart_id = tom.linked_member_id
    new_rels = {
        (r.from_member_id, r.to_member_id, r.relation_type)
        for r in relations_of(db, new_tree)
    }
    # Tom<->Anna and Tom<->Lena/Max become bridge relations.
    assert (counterpart_id, "anna", "partner") in new_rels
    assert ("lena", counterpart_id, "parent") in new_rels
    assert ("max", counterpart_id, "parent") in new_rels

    src_rels = {
        (r.from_member_id, r.to_member_id, r.relation_type)
        for r in relations_of(db, tree)
    }
    assert ("jan", "karl", "parent") in src_rels
    assert ("jan", "rosa", "parent") in src_rels
    assert ("tom", "karl", "parent") in src_rels
    assert ("tom", "rosa", "parent") in src_rels


def test_partnership_multiple_partners_all_sides_move(db):
    """Root has two partners; both partners' sides move."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    add_member(db, tree, "partner1")
    add_member(db, tree, "p1_parent")
    add_member(db, tree, "partner2")
    add_member(db, tree, "p2_parent")
    add_relation(db, tree, "root", "partner1", "partner")
    add_relation(db, tree, "root", "partner2", "partner")
    add_relation(db, tree, "partner1", "p1_parent", "parent")
    add_relation(db, tree, "partner2", "p2_parent", "parent")

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="partnership"),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    assert {"partner1", "p1_parent", "partner2", "p2_parent"} <= moved_ids


def test_partnership_no_partners_no_children_rejected(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "root")
    add_member(db, tree, "parent")
    add_relation(db, tree, "root", "parent", "parent")

    with pytest.raises(DomainError) as exc:
        extract_subtree(
            db, user,
            req(source_tree_id=tree.id, root_member_id="root",
                direction="partnership"),
        )
    assert exc.value.status_code == 400


def test_partnership_can_reach_back_into_roots_own_family(db):
    """Deliberately simple selection: two siblings married into the same
    family means partnership can reach back into the root's own blood
    family. This is accepted behaviour, not a bug."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "root")       # root
    add_member(db, tree, "sibling")    # root's sibling
    add_member(db, tree, "parent1")
    add_member(db, tree, "parent2")
    add_member(db, tree, "in_law")     # sibling's partner
    add_relation(db, tree, "root", "parent1", "parent")
    add_relation(db, tree, "root", "parent2", "parent")
    add_relation(db, tree, "sibling", "parent1", "parent")
    add_relation(db, tree, "sibling", "parent2", "parent")
    add_relation(db, tree, "root", "in_law", "partner")
    add_relation(db, tree, "sibling", "in_law", "partner")

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="partnership"),
    )

    moved_ids = {m.id for m in members_of(db, new_tree)}
    # in_law is a seed (root's partner); from in_law, sibling is reachable
    # (partner edge), and from sibling, parent1/parent2 are reachable too.
    assert {"in_law", "sibling", "parent1", "parent2"} <= moved_ids


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_old_direction_values_rejected_by_schema():
    for old_direction in ("whole_family", "descendants", "ancestors"):
        with pytest.raises(ValidationError):
            req(
                source_tree_id="t", root_member_id="root",
                direction=old_direction,
            )


def test_old_direction_values_rejected_by_the_endpoint(client, db):
    user = make_user(db, "alice")
    tree = make_canonical_family(db, user)
    for old_direction in ("whole_family", "descendants", "ancestors"):
        res = client.post(
            f"{API}/trees/extract-subtree",
            headers=auth(user),
            json={
                "name": "Moved",
                "source_tree_id": tree.id,
                "root_member_id": "anna",
                "direction": old_direction,
            },
        )
        assert res.status_code == 422


def test_move_requires_ownership(db):
    owner = make_user(db, "alice")
    editor = make_user(db, "bob")
    tree = make_family(db, owner)
    share(db, tree, editor, role="editor")
    with pytest.raises(DomainError) as exc:
        extract_subtree(
            db, editor,
            req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
        )
    assert exc.value.status_code == 403


def test_move_requires_tree_links_feature(db):
    user = make_user(db, "alice")
    tree = make_family(db, user)
    feature_service.set_state(db, "tree_links", "off")
    db.commit()
    try:
        with pytest.raises(DomainError) as exc:
            extract_subtree(
                db, user,
                req(source_tree_id=tree.id, root_member_id="root",
                    direction="direct_family"),
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
    with pytest.raises(DomainError) as exc:
        extract_subtree(
            db, user,
            req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
        )
    assert exc.value.status_code == 409


def test_move_rejects_empty_selection(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "lonely")
    with pytest.raises(DomainError) as exc:
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
            "direction": "direct_family",
        },
    )
    assert res.status_code == 409


def test_requires_accessible_source(db):
    owner = make_user(db, "owner")
    stranger = make_user(db, "mallory")
    private = make_tree(db, owner)
    add_member(db, private, "m1")

    with pytest.raises(DomainError) as exc:
        extract_subtree(
            db, stranger, req(source_tree_id=private.id, root_member_id="m1")
        )
    assert exc.value.status_code == 404


def test_foreign_root_member_raises(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1")

    with pytest.raises(DomainError) as exc:
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
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
    )

    assert preview.member_count == 5  # p1, c1, c2, gc1, aunt — root excluded
    assert preview.relation_count == 5  # c1->p1, c2->p1, gc1->c1, c1<->aunt kept
    # + one bridged (p1<->root's counterpart)
    assert preview.severed_relation_count == 1  # aunt<->outsider
    assert preview.media_bytes == 5

    # Nothing written: no new tree, members and relations untouched, file kept.
    assert db.query(Tree).count() == trees_before
    assert len(members_of(db, tree)) == 7
    assert len(relations_of(db, tree)) == 6
    assert (src_dir / "c1.webp").exists()
    assert db.get(Member, "root").linked_tree_id is None


def test_move_preview_enforces_ownership(db):
    owner = make_user(db, "alice")
    editor = make_user(db, "bob")
    tree = make_family(db, owner)
    share(db, tree, editor, role="editor")
    with pytest.raises(DomainError) as exc:
        compute_subtree_preview(
            db, editor,
            req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
        )
    assert exc.value.status_code == 403


def test_direct_family_preview_matches_extraction(db):
    user = make_user(db, "alice")
    tree = make_canonical_family(db, user)

    preview = compute_subtree_preview(
        db, user,
        req(source_tree_id=tree.id, root_member_id="anna", direction="direct_family"),
    )
    new_tree = extract_subtree(
        db, user,
        req(name="Moved 2", source_tree_id=tree.id, root_member_id="anna",
            direction="direct_family"),
    )

    moved_member_count = len(members_of(db, new_tree)) - 1  # exclude bridge counterpart
    assert preview.member_count == moved_member_count
    kept_and_bridged = len(relations_of(db, new_tree))
    assert preview.relation_count == kept_and_bridged


def test_partnership_preview_matches_extraction(db):
    user = make_user(db, "alice")
    tree = make_canonical_family(db, user)

    preview = compute_subtree_preview(
        db, user,
        req(source_tree_id=tree.id, root_member_id="tom", direction="partnership"),
    )
    new_tree = extract_subtree(
        db, user,
        req(name="Moved 2", source_tree_id=tree.id, root_member_id="tom",
            direction="partnership"),
    )

    moved_member_count = len(members_of(db, new_tree)) - 1  # exclude bridge counterpart
    assert preview.member_count == moved_member_count
    kept_and_bridged = len(relations_of(db, new_tree))
    assert preview.relation_count == kept_and_bridged


# ---------------------------------------------------------------------------
# Bridge survives deletion of the linking person (#535 point C)
# ---------------------------------------------------------------------------

def test_subtree_survives_deletion_of_bridge_member(db):
    """Deleting the bridge member from the source tree keeps the linked tree
    and all its members intact — nothing cascades from a member delete into
    another tree — but dissolves the now-broken tree-in-tree link so the
    surviving counterpart becomes an ordinary member again."""
    from app.api.routes.members import delete_member

    user = make_user(db, "alice")
    tree = make_family(db, user)

    new_tree = extract_subtree(
        db, user,
        req(source_tree_id=tree.id, root_member_id="root", direction="direct_family"),
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

    # The link is fully dissolved: deleting one half of a bridge person turns
    # the surviving counterpart back into an ordinary member (both link fields
    # cleared), rather than leaving a dangling tree-level link / broken badge.
    counterpart = db.get(Member, counterpart_id)
    assert counterpart.linked_member_id is None
    assert counterpart.linked_tree_id is None
