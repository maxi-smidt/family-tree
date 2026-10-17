"""Section-scoped traversal reaches the whole family inside the section.

A section is a family branch, so focusing it must show more than the single
lineage of whichever member happens to be picked as the default root: an aunt
picked as root used to surface only herself and her parents.
"""

import pytest

from app.models import Relation, Section, SectionMember
from app.services.workspaces.neighborhood import (
    NeighborhoodQuery,
    collect_neighborhood_page,
)
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
