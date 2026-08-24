"""Workspace-in-tree link traversal — workspaces reachable via member links.

Shared BFS helper used by the link-graph endpoint, the batch-sharing
endpoints, and the combined-statistics endpoint. Kept model/session-only (no
route imports) to avoid import cycles with ``app.api.routes``.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import role_for
from app.models import User, Workspace
from app.models.family import Member
from app.schemas.workspace import (
    LinkGraphBridgeMember,
    LinkGraphEdge,
    LinkGraphNode,
    LinkGraphOut,
)

# Depth/node caps shared by every traversal over the tree-link graph.
LINK_GRAPH_MAX_DEPTH = 10
LINK_GRAPH_MAX_NODES = 100
LINK_GRAPH_MAX_BRIDGE_MEMBERS = 5


def _is_accessible(db: Session, user: User, t: Workspace) -> bool:
    return user.is_admin or role_for(db, t, user) is not None or t.public_role == "viewer"


def reachable_linked_trees(db: Session, tree: Workspace, user: User) -> list[Workspace]:
    """Trees reachable from ``tree`` via member links, readable by ``user``.

    Same BFS/traversal rules as ``compute_link_graph`` (depth/node caps, only
    traversing through workspaces the user can read), but returns just the list of
    accessible target ``Workspace`` rows (excluding the anchor tree itself) since
    callers that only need the tree list (batch-sharing, combined statistics)
    don't need the edge/placeholder detail.
    """

    found: list[Workspace] = []
    frontier: list[tuple[Workspace, int]] = [(tree, 0)]
    visited: set[str] = {tree.id}

    while frontier:
        current, depth = frontier.pop(0)
        if depth >= LINK_GRAPH_MAX_DEPTH:
            continue
        if len(visited) >= LINK_GRAPH_MAX_NODES:
            continue

        target_ids = db.scalars(
            select(Member.linked_workspace_id)
            .where(
                Member.workspace_id == current.id, Member.linked_workspace_id.isnot(None)
            )
            .distinct()
        ).all()
        for target_id in target_ids:
            if target_id in visited:
                continue
            visited.add(target_id)
            if len(visited) > LINK_GRAPH_MAX_NODES:
                continue
            target = db.get(Workspace, target_id)
            if target is None or not _is_accessible(db, user, target):
                continue
            found.append(target)
            frontier.append((target, depth + 1))

    return found


def _member_name(member: Member) -> str | None:
    return " ".join(filter(None, [member.first_name, member.last_name])) or None


def compute_link_graph(db: Session, tree: Workspace, user: User) -> LinkGraphOut:
    """Graph of workspaces reachable from ``tree`` via tree-in-tree member links.

    BFS over ``member.linked_workspace_id`` starting at ``tree``. Trees ``user``
    cannot read become terminal placeholder nodes (no name, no member count,
    not expanded further) so nothing about them leaks. Bounded by depth and
    node-count caps; ``truncated`` is set when a cap stops expansion before
    the graph was fully explored.
    """
    nodes: dict[str, LinkGraphNode] = {}
    edges: dict[tuple[str, str], LinkGraphEdge] = {}
    truncated = False

    member_count = db.scalar(
        select(func.count()).select_from(Member).where(Member.workspace_id == tree.id)
    )
    nodes[tree.id] = LinkGraphNode(
        id=tree.id,
        name=tree.name,
        member_count=member_count or 0,
        role=role_for(db, tree, user),
        accessible=True,
        is_current=True,
    )

    # (tree, depth) frontier of accessible, expandable workspaces.
    frontier: list[tuple[Workspace, int]] = [(tree, 0)]
    visited: set[str] = {tree.id}

    while frontier:
        current, depth = frontier.pop(0)
        if depth >= LINK_GRAPH_MAX_DEPTH:
            truncated = True
            continue

        linked_members = db.scalars(
            select(Member)
            .where(
                Member.workspace_id == current.id, Member.linked_workspace_id.isnot(None)
            )
            .order_by(Member.id)
        ).all()
        if not linked_members:
            continue

        by_target: dict[str, list[Member]] = {}
        for m in linked_members:
            by_target.setdefault(m.linked_workspace_id, []).append(m)

        for target_id, members in by_target.items():
            edge_key = (current.id, target_id)
            edges[edge_key] = LinkGraphEdge(
                source_workspace_id=current.id,
                target_workspace_id=target_id,
                count=len(members),
                bridge_members=[
                    LinkGraphBridgeMember(id=m.id, name=_member_name(m))
                    for m in members[:LINK_GRAPH_MAX_BRIDGE_MEMBERS]
                ],
            )

            if target_id in visited:
                continue

            if len(nodes) >= LINK_GRAPH_MAX_NODES:
                truncated = True
                visited.add(target_id)
                continue

            visited.add(target_id)
            target = db.get(Workspace, target_id)
            if target is None:
                nodes[target_id] = LinkGraphNode(
                    id=target_id,
                    name=None,
                    member_count=None,
                    role=None,
                    accessible=False,
                    is_current=False,
                )
                continue

            if not _is_accessible(db, user, target):
                nodes[target_id] = LinkGraphNode(
                    id=target_id,
                    name=None,
                    member_count=None,
                    role=None,
                    accessible=False,
                    is_current=False,
                )
                continue

            target_count = db.scalar(
                select(func.count())
                .select_from(Member)
                .where(Member.workspace_id == target.id)
            )
            nodes[target_id] = LinkGraphNode(
                id=target_id,
                name=target.name,
                member_count=target_count or 0,
                role=role_for(db, target, user),
                accessible=True,
                is_current=False,
            )
            frontier.append((target, depth + 1))

    return LinkGraphOut(
        nodes=list(nodes.values()), edges=list(edges.values()), truncated=truncated
    )
