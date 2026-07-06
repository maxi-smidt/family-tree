"""Tree-in-tree link traversal — trees reachable via member links.

Shared BFS helper used by the link-graph endpoint, the batch-sharing
endpoints, and the combined-statistics endpoint. Kept model/session-only (no
route imports) to avoid import cycles with ``app.api.routes``.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import role_for
from app.models import Tree, User
from app.models.family import Member

# Depth/node caps shared by every traversal over the tree-link graph.
LINK_GRAPH_MAX_DEPTH = 10
LINK_GRAPH_MAX_NODES = 100


def reachable_linked_trees(db: Session, tree: Tree, user: User) -> list[Tree]:
    """Trees reachable from ``tree`` via member links, readable by ``user``.

    Same BFS/traversal rules as ``get_link_graph`` (depth/node caps, only
    traversing through trees the user can read), but returns just the list of
    accessible target ``Tree`` rows (excluding the anchor tree itself) since
    callers that only need the tree list (batch-sharing, combined statistics)
    don't need the edge/placeholder detail.
    """

    def is_accessible(t: Tree) -> bool:
        return (
            user.is_admin
            or role_for(db, t, user) is not None
            or t.public_role == "viewer"
        )

    found: list[Tree] = []
    frontier: list[tuple[Tree, int]] = [(tree, 0)]
    visited: set[str] = {tree.id}

    while frontier:
        current, depth = frontier.pop(0)
        if depth >= LINK_GRAPH_MAX_DEPTH:
            continue
        if len(visited) >= LINK_GRAPH_MAX_NODES:
            continue

        target_ids = db.scalars(
            select(Member.linked_tree_id)
            .where(Member.tree_id == current.id, Member.linked_tree_id.isnot(None))
            .distinct()
        ).all()
        for target_id in target_ids:
            if target_id in visited:
                continue
            visited.add(target_id)
            if len(visited) > LINK_GRAPH_MAX_NODES:
                continue
            target = db.get(Tree, target_id)
            if target is None or not is_accessible(target):
                continue
            found.append(target)
            frontier.append((target, depth + 1))

    return found
