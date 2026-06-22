import { Node, Rect } from "@xyflow/react";
import { NODE_HEIGHT, NODE_WIDTH } from "@/constants";

/**
 * Bounding box (flow coordinates) of the visible nodes.
 *
 * Hidden nodes (collapsed descendants) are skipped. Nodes that were never
 * rendered have no measured size because `onlyRenderVisibleElements` culls them,
 * so we fall back to an explicit width/height or the default card size — enough
 * to frame them. Returns null when there is nothing to frame.
 */
export function computeNodesBounds(nodes: Node[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (const node of nodes) {
    if (node.hidden) continue;
    count += 1;
    const width = node.measured?.width ?? node.width ?? NODE_WIDTH;
    const height = node.measured?.height ?? node.height ?? NODE_HEIGHT;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
  }

  if (count === 0) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

interface FitViewInstance {
  getNodes: () => Node[];
  fitBounds: (bounds: Rect, options?: { padding?: number }) => unknown;
}

/**
 * Fit the viewport to ALL nodes, including those currently culled by
 * `onlyRenderVisibleElements`. React Flow's built-in `fitView()` only frames
 * nodes it has already measured (i.e. on-screen), so on a panned/zoomed canvas
 * it appears to do nothing. We compute the full bounds from every node's stored
 * position and `fitBounds()` to them instead.
 */
export function fitViewToAllNodes(
  instance: FitViewInstance,
  padding = 0.2,
): void {
  const bounds = computeNodesBounds(instance.getNodes());
  if (!bounds) return;
  void instance.fitBounds(bounds, { padding });
}
