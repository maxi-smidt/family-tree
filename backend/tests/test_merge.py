from app.db.base import utcnow_iso
from app.models import (
    ContentScope,
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    Member,
    Relation,
    Section,
    SectionMember,
    SectionPosition,
    Story,
    StoryDocumentLink,
)
from app.services.workspaces.merge import merge_trees
from tests.conftest import add_member, make_tree, make_user


def test_merge_dedupes_identical_members(db):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")

    add_member(db, tree_a, "a1", first_name="Ada", last_name="Doe", gender="f")
    add_member(db, tree_b, "b1", first_name="ada", last_name="doe", gender="f")
    add_member(db, tree_b, "b2", first_name="Bob", last_name="Doe", gender="m")

    merged = merge_trees(db, user, "Merged", tree_a.id, tree_b.id)

    members = db.query(Member).filter(Member.workspace_id == merged.id).all()
    names = sorted((m.first_name.lower(), m.last_name.lower()) for m in members)
    # Ada (matched across both workspaces) collapses into one; Bob stays separate.
    assert names == [("ada", "doe"), ("bob", "doe")]


def test_merge_remaps_relations_and_regenerates_ids(db):
    user = make_user(db, "alice")
    source = make_tree(db, user, "Source")
    add_member(
        db,
        source,
        "child",
        first_name="Kid",
        middle_names="Middle",
        baptismal_name="Baptismal",
        gender="m",
    )
    add_member(db, source, "parent", first_name="Pa", gender="m")
    db.add(
        Relation(
            workspace_id=source.id,
            from_member_id="child",
            to_member_id="parent",
            relation_type="parent",
        )
    )
    db.commit()

    merged = merge_trees(db, user, "Copy", source.id, None)

    members = db.query(Member).filter(Member.workspace_id == merged.id).all()
    assert {m.id for m in members}.isdisjoint({"child", "parent"})  # ids regenerated
    child = next(m for m in members if m.first_name == "Kid")
    assert child.middle_names == "Middle"
    assert child.baptismal_name == "Baptismal"

    relations = db.query(Relation).filter(Relation.workspace_id == merged.id).all()
    assert len(relations) == 1
    id_by_name = {m.first_name: m.id for m in members}
    assert relations[0].from_member_id == id_by_name["Kid"]
    assert relations[0].to_member_id == id_by_name["Pa"]


def test_merge_copies_documents_into_new_tree(db):
    user = make_user(db, "alice")
    source = make_tree(db, user, "Source")
    add_member(db, source, "m1", first_name="Ada", gender="f")
    now = utcnow_iso()
    db.add(
        Story(
            id="s1", workspace_id=source.id, title="Tale", created_at=now, updated_at=now
        )
    )
    db.add(
        Document(
            id="doc1",
            workspace_id=source.id,
            title="Census",
            description="notes",
            created_at=now,
            updated_at=now,
        )
    )
    db.add(
        DocumentFile(
            id="df1",
            workspace_id=source.id,
            document_id="doc1",
            kind="link",
            filename="Record",
            url="https://example.com/record",
            created_at=now,
        )
    )
    db.add(DocumentMemberLink(document_id="doc1", member_id="m1"))
    db.add(StoryDocumentLink(story_id="s1", document_id="doc1"))
    db.commit()

    merged = merge_trees(db, user, "Copy", source.id, None)

    docs = db.query(Document).filter(Document.workspace_id == merged.id).all()
    assert len(docs) == 1
    copied = docs[0]
    assert copied.id != "doc1"  # ids regenerated
    assert copied.title == "Census"
    assert copied.description == "notes"

    files = db.query(DocumentFile).filter(DocumentFile.document_id == copied.id).all()
    assert len(files) == 1
    assert files[0].workspace_id == merged.id
    assert files[0].kind == "link"
    assert files[0].url == "https://example.com/record"

    # Member + story links repointed to the copied document, all within the
    # new tree (no cross-tree links).
    member_links = db.query(DocumentMemberLink).filter_by(document_id=copied.id).all()
    assert len(member_links) == 1
    linked_member = db.get(Member, member_links[0].member_id)
    assert linked_member.workspace_id == merged.id

    story_links = db.query(StoryDocumentLink).filter_by(document_id=copied.id).all()
    assert len(story_links) == 1
    linked_story = db.get(Story, story_links[0].story_id)
    assert linked_story.workspace_id == merged.id


def test_merge_copies_sections_and_membership(db):
    user = make_user(db, "alice")
    source = make_tree(db, user, "Source")
    add_member(db, source, "m1", first_name="Ada", gender="f")
    db.add(Section(id="sec1", workspace_id=source.id, name="Paternal", position=0))
    db.add(SectionMember(section_id="sec1", member_id="m1"))
    db.add(
        SectionPosition(section_id="sec1", member_id="m1", position_x=1.0, position_y=2.0)
    )
    db.commit()

    merged = merge_trees(db, user, "Copy", source.id, None)

    sections = db.query(Section).filter(Section.workspace_id == merged.id).all()
    assert len(sections) == 1
    section = sections[0]
    assert section.id != "sec1"
    assert section.name == "Paternal"

    new_member = db.query(Member).filter(Member.workspace_id == merged.id).one()
    members = db.query(SectionMember).filter_by(section_id=section.id).all()
    assert [m.member_id for m in members] == [new_member.id]

    positions = db.query(SectionPosition).filter_by(section_id=section.id).all()
    assert len(positions) == 1
    assert positions[0].member_id == new_member.id
    assert positions[0].position_x == 1.0
    assert positions[0].position_y == 2.0


def test_merge_dedupes_same_named_sections_across_sources(db):
    user = make_user(db, "alice")
    tree_a = make_tree(db, user, "A")
    tree_b = make_tree(db, user, "B")
    add_member(db, tree_a, "a1", first_name="Ada", gender="f")
    add_member(db, tree_b, "b1", first_name="Bob", gender="m")
    db.add(Section(id="sec_a", workspace_id=tree_a.id, name="Paternal", position=0))
    db.add(SectionMember(section_id="sec_a", member_id="a1"))
    db.add(Section(id="sec_b", workspace_id=tree_b.id, name="paternal", position=0))
    db.add(SectionMember(section_id="sec_b", member_id="b1"))
    db.commit()

    merged = merge_trees(db, user, "Merged", tree_a.id, tree_b.id)

    sections = db.query(Section).filter(Section.workspace_id == merged.id).all()
    assert len(sections) == 1
    members = db.query(SectionMember).filter_by(section_id=sections[0].id).all()
    assert len(members) == 2  # both source members folded into the one section


def test_merge_preserves_content_section_scope(db):
    user = make_user(db, "alice")
    source = make_tree(db, user, "Source")
    add_member(db, source, "m1", first_name="Ada", gender="f")
    db.add(Section(id="sec1", workspace_id=source.id, name="Paternal", position=0))
    db.add(SectionMember(section_id="sec1", member_id="m1"))
    db.commit()

    now = utcnow_iso()
    db.add(
        Event(
            id="e1",
            workspace_id=source.id,
            event_type="birth",
            date="2020-01-01",
            created_at=now,
        )
    )
    db.add(
        ContentScope(
            content_type="event",
            content_id="e1",
            workspace_id=source.id,
            section_id="sec1",
            created_at=now,
        )
    )
    db.commit()

    merged = merge_trees(db, user, "Copy", source.id, None)

    event = db.query(Event).filter(Event.workspace_id == merged.id).one()
    section = db.query(Section).filter(Section.workspace_id == merged.id).one()
    scope = db.get(ContentScope, ("event", event.id))
    assert scope is not None
    assert scope.section_id == section.id


def test_merge_requires_owned_or_shared_source(db):
    owner = make_user(db, "owner")
    stranger = make_user(db, "mallory")
    private_tree = make_tree(db, owner, "Private")

    import pytest

    from app.core.exceptions import DomainError

    with pytest.raises(DomainError) as exc:
        merge_trees(db, stranger, "Steal", private_tree.id, None)
    assert exc.value.status_code == 404
