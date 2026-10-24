"""Section-scoped traversal reaches the whole family inside the section.

A section is a family branch, so focusing it must show more than the single
lineage of whichever member happens to be picked as the default root: an aunt
picked as root used to surface only herself and her parents.
"""

import pytest

from app.models import Relation, Section, SectionMember
from app.services.workspaces.neighborhood import (
    ALL_GENERATIONS,
    NeighborhoodQuery,
    collect_neighborhood_page,
    pick_default_root,
)
from app.services.workspaces.subtree_selection import collect_member_ids
from tests.conftest import add_member, make_tree, make_user

# child -> parents
_PARENTS = {
    "homer": ("abe", "mona"),
    "marge": ("clancy", "jackie"),
    "patty": ("clancy", "jackie"),
    "selma": ("clancy", "jackie"),
    "bart": ("homer", "marge"),
    "lisa": ("homer", "marge"),
    "maggie": ("homer", "marge"),
}
_COUPLES = (("abe", "mona"), ("clancy", "jackie"), ("homer", "marge"))
_ALL = sorted({*_PARENTS, *(p for ps in _PARENTS.values() for p in ps)})


@pytest.fixture
def simpsons(db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    for member_id in _ALL:
        add_member(db, tree, member_id)
    for child, parents in _PARENTS.items():
        for parent in parents:
            db.add(
                Relation(
                    workspace_id=tree.id,
                    from_member_id=child,
                    to_member_id=parent,
                    relation_type="parent",
                )
            )
    for a, b in _COUPLES:
        db.add(
            Relation(
                workspace_id=tree.id,
                from_member_id=a,
                to_member_id=b,
                relation_type="married",
            )
        )
    section = Section(workspace_id=tree.id, name="Simpsons")
    db.add(section)
    db.commit()
    db.add_all(SectionMember(section_id=section.id, member_id=m) for m in _ALL)
    db.commit()
    return tree, section


def _query(root, section_id, *, up=3, down=3, partners=True):
    return NeighborhoodQuery(
        root_id=root,
        up=up,
        down=down,
        include_partners=partners,
        section_ids=(section_id,),
        budget=1500,
    )


@pytest.mark.parametrize("root", _ALL)
def test_section_focus_reaches_every_member_from_any_root(db, simpsons, root):
    tree, section = simpsons
    page = collect_neighborhood_page(db, tree.id, _query(root, section.id), 0)
    assert sorted(page.member_ids) == _ALL
    assert page.has_more is False
    assert page.expandable is False


def test_section_focus_respects_generation_band(db, simpsons):
    tree, section = simpsons
    # From Bart, one generation up and none down: parents and siblings, but
    # not the grandparents, nor the aunts only reachable through them.
    page = collect_neighborhood_page(
        db, tree.id, _query("bart", section.id, up=1, down=0), 0
    )
    assert sorted(page.member_ids) == ["bart", "homer", "lisa", "maggie", "marge"]
    assert page.expandable is True


def test_section_focus_does_not_walk_through_members_outside_it(db, simpsons):
    tree, section = simpsons
    db.query(SectionMember).filter(SectionMember.member_id == "marge").delete()
    db.commit()
    page = collect_neighborhood_page(db, tree.id, _query("patty", section.id), 0)
    # Marge is outside the section, and she is the only link between her
    # parents' side and Homer's: the walk stays on Patty's side.
    assert "marge" not in page.member_ids
    assert sorted(page.member_ids) == ["clancy", "jackie", "patty", "selma"]


def test_extended_family_section_at_full_depth_shows_the_origins_children(db):
    """#1169: the default root of a deep extended-family section can sit far
    above the person it was made from; at full depth (what the canvas now
    asks for) their children are still on screen."""
    user = make_user(db, "bob")
    tree = make_tree(db, user)
    parents = {
        "a": ("z1", "z2"),
        "b": ("a", "a2"),
        "c": ("b", "b2"),
        "p": ("c", "c2"),
        "k": ("p", "p2"),
    }
    couples = [("a", "a2"), ("a", "a3"), ("b", "b2"), ("c", "c2"), ("p", "p2")]
    members = sorted({*parents, *(x for ps in parents.values() for x in ps), "a3"})
    for member_id in members:
        add_member(db, tree, member_id)
    for child, pair in parents.items():
        for parent in pair:
            db.add(
                Relation(
                    workspace_id=tree.id,
                    from_member_id=child,
                    to_member_id=parent,
                    relation_type="parent",
                )
            )
    for a, b in couples:
        db.add(
            Relation(
                workspace_id=tree.id,
                from_member_id=a,
                to_member_id=b,
                relation_type="married",
            )
        )
    db.commit()
    section_members = collect_member_ids(db, tree.id, "p", "extended_family") | {"p"}
    section = Section(workspace_id=tree.id, name="P's family")
    db.add(section)
    db.commit()
    db.add_all(SectionMember(section_id=section.id, member_id=m) for m in section_members)
    db.commit()

    root = pick_default_root(db, tree.id, [section.id])
    assert root == "a"
    # Three generations down from "a" stops at "p": the old default hid "k".
    shallow = collect_neighborhood_page(db, tree.id, _query(root, section.id), 0)
    assert "k" not in shallow.member_ids
    full = collect_neighborhood_page(
        db,
        tree.id,
        _query(root, section.id, up=ALL_GENERATIONS, down=ALL_GENERATIONS),
        0,
    )
    assert sorted(full.member_ids) == sorted(section_members)
