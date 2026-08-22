"""Branch selection for sub-tree extraction.

Given a root member and a ``direction``, decides which other members belong
in the branch being cut out into a new tree, and classifies a tree's
relations against that selection. Pure over already-loaded rows — no writes,
no session commits — so it is usable from both the preview and the actual
move in ``app.services.trees.extract``.
"""

from __future__ import annotations

from collections import deque

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.models import Member, Relation

MemberIdSet = dict[str, set[str]]


def _load_relations(db: Session, tree_id: str) -> list[Relation]:
    return list(db.scalars(select(Relation).where(Relation.tree_id == tree_id)))


def _pull_one_hop_partners(
    relations: list[Relation], moved: set[str], root_id: str
) -> None:
    """Add, in place, everyone sharing a non-parent (partner-like) relation
    with a member already in ``moved`` — a single hop, no further traversal
    from the pulled-in members. Partners of the root itself are excluded
    (the root is the bridge, never in ``moved``)."""
    peers: set[str] = set()
    for r in relations:
        if r.relation_type == "parent":
            continue
        if r.from_member_id == root_id or r.to_member_id == root_id:
            continue
        if r.from_member_id in moved:
            peers.add(r.to_member_id)
        if r.to_member_id in moved:
            peers.add(r.from_member_id)
    moved |= peers


def _collect_direct_family_ids(
    db: Session, tree_id: str, root_id: str
) -> set[str]:
    """"Direct family" selection: the root's family of origin.

    The root R stays as the bridge; R's own children/descendants do NOT
    move (they belong to R's partnership in the main tree).

    1. Build the vertical (parent-edge) adjacency, traversable both ways.
    2. moved = BFS over vertical edges starting from R's PARENTS (rows
       where from=R: their to-members), never visiting R itself. This
       yields parents, grandparents, siblings (down from parents),
       aunts/uncles/cousins (down from higher ancestors) — but never R's
       own children, since downward traversal from R never happens (and
       any path back down to them passes through R, which is blocked).
    3. One-hop partner pull: every member sharing a non-parent relation
       with a moved member is added to moved (single hop, no further
       traversal) — e.g. a moved brother's wife comes along instead of
       being severed. Partners of R itself are NOT pulled.
    4. R is excluded from the returned set (it is the bridge).
    """
    relations = _load_relations(db, tree_id)

    vertical: MemberIdSet = {}

    def link(a: str, b: str) -> None:
        vertical.setdefault(a, set()).add(b)
        vertical.setdefault(b, set()).add(a)

    root_parents: set[str] = set()
    for r in relations:
        if r.relation_type != "parent":
            continue
        link(r.from_member_id, r.to_member_id)
        if r.from_member_id == root_id:
            root_parents.add(r.to_member_id)

    moved: set[str] = set()
    queue: deque[str] = deque()
    for p in root_parents:
        if p not in moved:
            moved.add(p)
            queue.append(p)
    while queue:
        node = queue.popleft()
        for nb in vertical.get(node, ()):
            if nb == root_id or nb in moved:
                continue
            moved.add(nb)
            queue.append(nb)

    _pull_one_hop_partners(relations, moved, root_id)
    moved.discard(root_id)
    return moved


def _collect_partnership_ids(
    db: Session, tree_id: str, root_id: str
) -> set[str]:
    """"Partnership" selection: the root's partner(s) and their world, plus
    the shared children.

    The root R stays as the bridge; the partner side and the shared children
    move.

    1. seeds = all of R's partners (members sharing any non-parent relation
       with R) + all of R's children (parent rows where to=R: their
       from-members).
    2. moved = BFS from all seeds over ALL edges (vertical + horizontal),
       never visiting R.
    3. R is excluded from the returned set (it is the bridge).

    Deliberately simple: in tangled trees (e.g. two siblings married into
    the same family) this can reach back into the root's own blood family —
    accepted; the preview's member count reveals it. No cleverness is added
    to prevent that (unlike "direct family", which has no such need since it
    never leaves the vertical axis until the one-hop partner pull).
    """
    relations = _load_relations(db, tree_id)

    adjacency: MemberIdSet = {}

    def link(a: str, b: str) -> None:
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)

    seeds: set[str] = set()
    for r in relations:
        link(r.from_member_id, r.to_member_id)
        if r.relation_type == "parent":
            # from = child, to = parent. Root's children: root is the parent.
            if r.to_member_id == root_id:
                seeds.add(r.from_member_id)
        else:
            if r.from_member_id == root_id:
                seeds.add(r.to_member_id)
            elif r.to_member_id == root_id:
                seeds.add(r.from_member_id)

    moved: set[str] = set()
    queue: deque[str] = deque()
    for s in seeds:
        if s not in moved:
            moved.add(s)
            queue.append(s)
    while queue:
        node = queue.popleft()
        for nb in adjacency.get(node, ()):
            if nb == root_id or nb in moved:
                continue
            moved.add(nb)
            queue.append(nb)

    return moved


def collect_member_ids(
    db: Session, tree_id: str, root_id: str, direction: str
) -> set[str]:
    """Return the set of member ids that belong in the sub-tree for ``direction``."""
    root = db.scalar(
        select(Member).where(Member.tree_id == tree_id, Member.id == root_id)
    )
    if root is None:
        raise NotFoundError("Root member not found in tree")

    if direction == "partnership":
        return _collect_partnership_ids(db, tree_id, root_id)
    return _collect_direct_family_ids(db, tree_id, root_id)


def classify_relations(
    relations: list[Relation],
    moved: set[str],
    root_id: str,
) -> tuple[list[Relation], list[Relation], list[Relation]]:
    """Split a source tree's relations for a move.

    Returns ``(kept, bridged, severed)``:

    - kept: both endpoints move → recreated as-is in the new tree,
    - bridged: root ↔ moved → recreated with the root replaced by its
      counterpart (the bridge person carries the seam),
    - severed: moved ↔ anything staying (other than the root) → deleted.

    Relations entirely among staying members are not returned (untouched).
    """
    kept: list[Relation] = []
    bridged: list[Relation] = []
    severed: list[Relation] = []
    for r in relations:
        from_moved = r.from_member_id in moved
        to_moved = r.to_member_id in moved
        if from_moved and to_moved:
            kept.append(r)
        elif from_moved or to_moved:
            other = r.to_member_id if from_moved else r.from_member_id
            if other == root_id:
                bridged.append(r)
            else:
                severed.append(r)
    return kept, bridged, severed
