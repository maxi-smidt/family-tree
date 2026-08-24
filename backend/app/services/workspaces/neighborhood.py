"""Bounded-neighborhood BFS for the focused tree view.

Reuses the same adjacency construction as ``services/extract.py`` but
exposes separate ancestor (``up``) and descendant (``down``) depth limits
and enforces a hard node cap so the result stays renderable.
"""

from __future__ import annotations

from collections import deque

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Member, Relation

MAX_NEIGHBORHOOD_NODES = 1500


def collect_neighborhood_ids(
    db: Session,
    workspace_id: str,
    root_id: str,
    up: int,
    down: int,
    include_partners: bool,
) -> tuple[set[str], bool]:
    """Return ``(member_ids, truncated)``.

    Performs a bounded BFS from *root_id*: up to *up* ancestor generations
    and *down* descendant generations.  Once the accumulated set reaches
    ``MAX_NEIGHBORHOOD_NODES`` no more members are added and *truncated* is
    ``True``.
    """
    # Build parent-edge adjacency from the tree's parent relations.
    # Convention: from=child, to=parent.
    parent_rows = list(
        db.execute(
            select(Relation.from_member_id, Relation.to_member_id).where(
                Relation.workspace_id == workspace_id,
                Relation.relation_type == "parent",
            )
        ).all()
    )
    parents_of: dict[str, list[str]] = {}  # child_id → [parent_id, ...]
    children_of: dict[str, list[str]] = {}  # parent_id → [child_id, ...]
    for row in parent_rows:
        parents_of.setdefault(row.from_member_id, []).append(row.to_member_id)
        children_of.setdefault(row.to_member_id, []).append(row.from_member_id)

    core: set[str] = {root_id}
    truncated = False

    def _bfs(start: str, graph: dict[str, list[str]], max_depth: int) -> None:
        nonlocal truncated
        visited: set[str] = {start}
        queue: deque[tuple[str, int]] = deque([(start, 0)])
        while queue:
            node, d = queue.popleft()
            if d >= max_depth:
                continue
            for nb in graph.get(node, []):
                if nb not in visited:
                    visited.add(nb)
                    if nb not in core:
                        if len(core) >= MAX_NEIGHBORHOOD_NODES:
                            truncated = True
                            return
                        core.add(nb)
                    queue.append((nb, d + 1))

    if down > 0:
        _bfs(root_id, children_of, down)
    if up > 0 and not truncated:
        _bfs(root_id, parents_of, up)

    if include_partners and not truncated:
        # Add one-hop peers (partners/married/divorced/siblings) of core members.
        peer_rows = list(
            db.execute(
                select(Relation.from_member_id, Relation.to_member_id).where(
                    Relation.workspace_id == workspace_id,
                    Relation.relation_type != "parent",
                )
            ).all()
        )
        peers: set[str] = set()
        for row in peer_rows:
            if row.from_member_id in core:
                peers.add(row.to_member_id)
            if row.to_member_id in core:
                peers.add(row.from_member_id)
        new_peers = peers - core
        if new_peers:
            existing_ids = set(
                db.scalars(
                    select(Member.id).where(
                        Member.workspace_id == workspace_id,
                        Member.id.in_(new_peers),
                    )
                )
            )
            for pid in existing_ids:
                if len(core) >= MAX_NEIGHBORHOOD_NODES:
                    truncated = True
                    break
                core.add(pid)

    return core, truncated


def pick_default_root(db: Session, workspace_id: str) -> str | None:
    """Return the id of the most-connected member, or ``None`` if tree is empty."""
    row = db.execute(
        select(Relation.from_member_id, func.count().label("cnt"))
        .where(Relation.workspace_id == workspace_id)
        .group_by(Relation.from_member_id)
        .order_by(func.count().desc())
        .limit(1)
    ).first()
    if row is not None:
        return row.from_member_id
    # No relations at all — fall back to the first member in insertion order.
    return db.scalar(
        select(Member.id).where(Member.workspace_id == workspace_id).limit(1)
    )
