"""Seed two demo trees for testing the merge/preview workflow.

Usage (from backend/):
    uv run python -m scripts.seed_merge_demo [--username admin]

Creates two trees owned by the given user:
 - "Miller Family":  ~12 members across 3 generations
 - "Schmidt-Miller Family": ~10 members with overlapping data

Safe to run multiple times: skips creation if trees with those names
already exist for the target user.
"""

from __future__ import annotations

import argparse
import sys
from uuid import uuid4

from sqlalchemy import select

from app.core.constants import DEFAULT_RELATION_TYPES
from app.db.base import utcnow_iso
from app.db.session import SessionLocal
from app.models import (
    Event,
    EventMemberLink,
    Member,
    MemberDisease,
    Relation,
    RelationType,
    Story,
    StoryMemberLink,
    Tree,
    User,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NOW = utcnow_iso()


def _uid() -> str:
    return str(uuid4())


def _make_tree(db, owner_id: str, name: str) -> Tree:
    tree = Tree(
        id=_uid(),
        name=name,
        owner_id=owner_id,
        created_at=NOW,
        last_opened=NOW,
    )
    db.add(tree)
    db.flush()
    for rt in DEFAULT_RELATION_TYPES:
        db.add(RelationType(tree_id=tree.id, id=rt))
    db.flush()
    return tree


def _add_member(db, tree_id: str, **kwargs) -> Member:
    m = Member(id=_uid(), tree_id=tree_id, **kwargs)
    db.add(m)
    return m


def _add_relation(db, tree_id: str, from_id: str, to_id: str, rel_type: str) -> None:
    db.add(
        Relation(
            tree_id=tree_id,
            from_member_id=from_id,
            to_member_id=to_id,
            relation_type=rel_type,
        )
    )


def _add_disease(db, tree_id: str, member_id: str, name: str, **kwargs) -> None:
    db.add(
        MemberDisease(
            id=_uid(),
            tree_id=tree_id,
            member_id=member_id,
            name=name,
            carrier_status=kwargs.get("carrier_status", "affected"),
            inheritance_pattern=kwargs.get("inheritance_pattern", "unknown"),
            diagnosis_date=kwargs.get("diagnosis_date"),
            notes=kwargs.get("notes"),
        )
    )


# ---------------------------------------------------------------------------
# Tree A: Miller Family  (~12 members, 3 generations)
# ---------------------------------------------------------------------------

def _seed_miller_family(db, owner_id: str) -> Tree:
    tree = _make_tree(db, owner_id, "Miller Family")
    tid = tree.id

    # Generation 1 – grandparents
    henry = _add_member(db, tid, firstName="Henry", lastName="Miller", gender="m",
                        dateOfBirth="1920", dateOfDeath="1998",
                        birthplace="München", hometown="München",
                        additionalData="Veteran of WW2. Worked as a carpenter.")
    margaret = _add_member(db, tid, firstName="Margaret", lastName="Miller", gender="f",
                           dateOfBirth="1923", dateOfDeath="2005",
                           birthplace="Hamburg", hometown="München",
                           maidenName="Weber",
                           additionalData="Schoolteacher for 30 years.")
    db.flush()

    # Generation 2 – children
    robert = _add_member(db, tid, firstName="Robert", lastName="Miller", gender="m",
                         dateOfBirth="1948", birthplace="München",
                         hometown="Frankfurt")
    elise = _add_member(db, tid, firstName="Elise", lastName="Miller", gender="f",
                        dateOfBirth="1950", birthplace="München",
                        hometown="Berlin")
    walter = _add_member(db, tid, firstName="Walter", lastName="Miller", gender="m",
                         dateOfBirth="1955", birthplace="München",
                         hometown="München")

    # Generation 2 – spouses
    claire = _add_member(db, tid, firstName="Claire", lastName="Miller", gender="f",
                         dateOfBirth="1950", birthplace="Köln",
                         maidenName="Braun",
                         additionalData="Worked as a nurse.")
    thomas_husband = _add_member(
        db, tid, firstName="Thomas", lastName="Braun", gender="m",
        dateOfBirth="1948", birthplace="Bonn",
    )
    db.flush()

    # Generation 3 – grandchildren
    sophia = _add_member(db, tid, firstName="Sophia", lastName="Miller", gender="f",
                         dateOfBirth="1975", birthplace="Frankfurt")
    lucas = _add_member(db, tid, firstName="Lucas", lastName="Miller", gender="m",
                        dateOfBirth="1978", birthplace="Frankfurt")
    anna_miller = _add_member(db, tid, firstName="Anna", lastName="Braun", gender="f",
                              dateOfBirth="1976", birthplace="Berlin")
    felix = _add_member(db, tid, firstName="Felix", lastName="Braun", gender="m",
                        dateOfBirth="1979", birthplace="Berlin")
    mia = _add_member(db, tid, firstName="Mia", lastName="Miller", gender="f",
                      dateOfBirth="1982", birthplace="München")
    db.flush()

    # Relations
    # Gen 1 partners
    _add_relation(db, tid, henry.id, margaret.id, "partner")
    # Henry/Margaret → children (parent relations: child→parent)
    for child in [robert, elise, walter]:
        _add_relation(db, tid, child.id, henry.id, "parent")
        _add_relation(db, tid, child.id, margaret.id, "parent")

    # Gen 2 partners
    _add_relation(db, tid, robert.id, claire.id, "married")
    _add_relation(db, tid, elise.id, thomas_husband.id, "married")

    # Robert+Claire → children
    for gc in [sophia, lucas]:
        _add_relation(db, tid, gc.id, robert.id, "parent")
        _add_relation(db, tid, gc.id, claire.id, "parent")

    # Elise+Thomas → children
    for gc in [anna_miller, felix]:
        _add_relation(db, tid, gc.id, elise.id, "parent")
        _add_relation(db, tid, gc.id, thomas_husband.id, "parent")

    # Walter → child
    _add_relation(db, tid, mia.id, walter.id, "parent")
    db.flush()

    # Diseases
    _add_disease(db, tid, henry.id, "Heart Disease",
                 carrier_status="affected", notes="Diagnosed at age 65.")
    _add_disease(db, tid, robert.id, "Heart Disease",
                 carrier_status="carrier", notes="Genetic risk.")

    # Event
    wedding = Event(
        id=_uid(), tree_id=tid,
        event_type="wedding",
        date="1945-06-15",
        location="München",
        description="Henry and Margaret's wedding after the war.",
        created_at=NOW,
    )
    db.add(wedding)
    db.flush()
    db.add(EventMemberLink(event_id=wedding.id, member_id=henry.id))
    db.add(EventMemberLink(event_id=wedding.id, member_id=margaret.id))

    # Story
    story = Story(
        id=_uid(), tree_id=tid,
        title="Henry's Workshop",
        content=(
            "Henry Miller ran a small carpentry workshop in the heart of München "
            "for over 40 years. He taught his son Robert the trade, and Robert "
            "went on to open his own furniture business in Frankfurt."
        ),
        created_at=NOW, updated_at=NOW,
    )
    db.add(story)
    db.flush()
    db.add(StoryMemberLink(story_id=story.id, member_id=henry.id))
    db.add(StoryMemberLink(story_id=story.id, member_id=robert.id))
    db.flush()

    return tree


# ---------------------------------------------------------------------------
# Tree B: Schmidt-Miller Family (~10 members, overlapping)
# ---------------------------------------------------------------------------

def _seed_schmidt_miller_family(db, owner_id: str) -> Tree:
    tree = _make_tree(db, owner_id, "Schmidt-Miller Family")
    tid = tree.id

    # EXACT DUPLICATE 1: Henry Miller (same name/gender/dates, conflicting fields)
    henry_dup = _add_member(
        db, tid,
        firstName="Henry", lastName="Miller", gender="m",
        dateOfBirth="1920", dateOfDeath="1998",
        birthplace="Berlin",       # CONFLICT: Miller Family has "München"
        hometown="Berlin",
        # CONFLICT with Miller Family's additionalData
        additionalData="Family patriarch. Known for his woodworking skill.",
        maidenName=None,
    )

    # EXACT DUPLICATE 2: Margaret Miller (conflicting maidenName/birthplace)
    margaret_dup = _add_member(
        db, tid,
        firstName="Margaret", lastName="Miller", gender="f",
        dateOfBirth="1923", dateOfDeath="2005",
        birthplace="Kiel",             # CONFLICT: Miller Family has "Hamburg"
        hometown="München",
        maidenName="Schmidt",          # CONFLICT: Miller Family has "Weber"
        additionalData="Beloved teacher and grandmother.",  # CONFLICT
    )
    db.flush()

    # --- POSSIBLE CANDIDATE: Anna (same name+gender, different birth year) ---
    anna_possible = _add_member(
        db, tid,
        firstName="Anna", lastName="Braun", gender="f",
        dateOfBirth="1977",            # CONFLICT: Miller Family has "1976"
        birthplace="Berlin",
    )

    # Schmidt-side unique members
    ernst = _add_member(db, tid, firstName="Ernst", lastName="Schmidt", gender="m",
                        dateOfBirth="1918", dateOfDeath="1990",
                        birthplace="Leipzig", hometown="Leipzig",
                        additionalData="Farmer and community leader.")
    ida = _add_member(db, tid, firstName="Ida", lastName="Schmidt", gender="f",
                      dateOfBirth="1922", dateOfDeath="2001",
                      birthplace="Dresden", hometown="Leipzig",
                      maidenName="Hoffmann")
    db.flush()

    karl = _add_member(db, tid, firstName="Karl", lastName="Schmidt", gender="m",
                       dateOfBirth="1948", birthplace="Leipzig",
                       hometown="Hannover")
    hilde = _add_member(db, tid, firstName="Hilde", lastName="Schmidt", gender="f",
                        dateOfBirth="1950", birthplace="Leipzig",
                        hometown="Hannover", maidenName="Vogel")
    db.flush()

    peter = _add_member(db, tid, firstName="Peter", lastName="Schmidt", gender="m",
                        dateOfBirth="1975", birthplace="Hannover")
    lena = _add_member(db, tid, firstName="Lena", lastName="Schmidt", gender="f",
                       dateOfBirth="1978", birthplace="Hannover")
    db.flush()

    # Relations
    _add_relation(db, tid, henry_dup.id, margaret_dup.id, "partner")

    _add_relation(db, tid, ernst.id, ida.id, "married")
    _add_relation(db, tid, karl.id, ernst.id, "parent")
    _add_relation(db, tid, karl.id, ida.id, "parent")

    _add_relation(db, tid, karl.id, hilde.id, "married")
    _add_relation(db, tid, peter.id, karl.id, "parent")
    _add_relation(db, tid, peter.id, hilde.id, "parent")
    _add_relation(db, tid, lena.id, karl.id, "parent")
    _add_relation(db, tid, lena.id, hilde.id, "parent")

    _add_relation(db, tid, anna_possible.id, henry_dup.id, "parent")
    _add_relation(db, tid, anna_possible.id, margaret_dup.id, "parent")
    db.flush()

    # Disease on Ernst
    _add_disease(db, tid, ernst.id, "Diabetes",
                 carrier_status="affected", notes="Type 2, managed with diet.")

    # Event
    reunion = Event(
        id=_uid(), tree_id=tid,
        event_type="reunion",
        date="2000-08-20",
        location="Leipzig",
        description="Schmidt family reunion at the old farmhouse.",
        created_at=NOW,
    )
    db.add(reunion)
    db.flush()
    db.add(EventMemberLink(event_id=reunion.id, member_id=ernst.id))
    db.add(EventMemberLink(event_id=reunion.id, member_id=karl.id))

    # Story
    story = Story(
        id=_uid(), tree_id=tid,
        title="Ernst Schmidt's Farm",
        content=(
            "Ernst Schmidt inherited his father's farm outside Leipzig after the war. "
            "He expanded it and raised his family there. His son Karl eventually "
            "moved north to Hannover but kept strong ties to the family land."
        ),
        created_at=NOW, updated_at=NOW,
    )
    db.add(story)
    db.flush()
    db.add(StoryMemberLink(story_id=story.id, member_id=ernst.id))
    db.add(StoryMemberLink(story_id=story.id, member_id=karl.id))
    db.flush()

    return tree


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(username: str) -> None:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            print(f"ERROR: User '{username}' not found.", file=sys.stderr)
            sys.exit(1)

        # Safety: skip if trees already exist for this user
        existing_names = set(
            db.scalars(
                select(Tree.name).where(Tree.owner_id == user.id)
            ).all()
        )

        created: list[str] = []

        if "Miller Family" not in existing_names:
            tree_a = _seed_miller_family(db, user.id)
            db.commit()
            created.append(f"  Miller Family          id={tree_a.id}")
        else:
            print("  Skipping 'Miller Family' — already exists.")

        if "Schmidt-Miller Family" not in existing_names:
            tree_b = _seed_schmidt_miller_family(db, user.id)
            db.commit()
            created.append(f"  Schmidt-Miller Family  id={tree_b.id}")
        else:
            print("  Skipping 'Schmidt-Miller Family' — already exists.")

        if created:
            print("Created demo trees:")
            for line in created:
                print(line)
        else:
            print("Both demo trees already exist — nothing to do.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed merge demo trees.")
    parser.add_argument(
        "--username", default="admin",
        help="Username of the tree owner (default: admin).",
    )
    args = parser.parse_args()
    main(args.username)
