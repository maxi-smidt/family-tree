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

export interface LinkGraphPoint {
  x: number;
  y: number;
}

export interface LinkGraphLayoutResult<
  NodeData extends Record<string, unknown>,
> {
  nodes: Node<NodeData>[];
  /**
   * Dagre's routing polyline per edge id: border-to-border waypoints that
   * bend around intermediate nodes instead of cutting straight through them.
   * Dagre positions node *centers*, and we place each node's top-left at
   * (center - half size), so these points are already in flow coordinates.
   */
  edgePoints: Map<string, LinkGraphPoint[]>;
}

export function layoutLinkGraph<NodeData extends Record<string, unknown>>(
  nodes: Node<NodeData>[],
  edges: Edge[],
): LinkGraphLayoutResult<NodeData> {
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

  const edgePoints = new Map<string, LinkGraphPoint[]>();
  edges.forEach((edge) => {
    const geometry = g.edge(edge.source, edge.target);
    edgePoints.set(
      edge.id,
      (geometry?.points ?? []).map((p: LinkGraphPoint) => ({
        x: p.x,
        y: p.y,
      })),
    );
  });

  const laidOutNodes = nodes.map((node) => {
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

  return { nodes: laidOutNodes, edgePoints };
}
