import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { Position } from "@xyflow/react";

/**
 * Small, self-contained dagre layout for the linked-trees graph dialog.
 *
 * Deliberately separate from `utils/layoutUtils.ts` (which lays out family
 * members) — this graph has different semantics (trees, not people) and a
 * much simpler shape: fixed-size nodes, left-to-right, and cycles are legal
 * (A links to B which links back to A). Dagre tolerates cycles by breaking
 * them internally when ranking, so no special handling is needed here.
 */
export const LINK_GRAPH_NODE_WIDTH = 220;
export const LINK_GRAPH_NODE_HEIGHT = 88;

export function layoutLinkGraph<NodeData extends Record<string, unknown>>(
  nodes: Node<NodeData>[],
  edges: Edge[],
): Node<NodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    g.setNode(node.id, {
      width: LINK_GRAPH_NODE_WIDTH,
      height: LINK_GRAPH_NODE_HEIGHT,
    });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      position: {
        x: pos.x - LINK_GRAPH_NODE_WIDTH / 2,
        y: pos.y - LINK_GRAPH_NODE_HEIGHT / 2,
      },
    };
  });
}
