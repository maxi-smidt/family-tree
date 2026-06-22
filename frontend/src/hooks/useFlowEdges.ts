import { useMemo } from "react";
import { Edge } from "@xyflow/react";
import type { WorkerEdge, WorkerEdgeStyle } from "@/workers/treeProcessor.types";

const CONNECTION_STROKE = "hsl(45 93% 47%)";
const EMPTY_EDGE_KEYS = new Set<string>();

const connectionStyle = (
  base: WorkerEdgeStyle,
  isHighlighted: boolean,
  hasConnectionPath: boolean,
): Edge["style"] => {
  if (isHighlighted) {
    return {
      ...base,
      opacity: 1,
      stroke: CONNECTION_STROKE,
      strokeWidth: 4,
    } as Edge["style"];
  }

  if (hasConnectionPath) {
    return { ...base, opacity: 0.2 } as Edge["style"];
  }

  return base as Edge["style"];
};

/**
 * Applies highlight/dim styling and animation to the base edges computed by
 * the tree-processor worker. The structural edge list (source, target, type,
 * base colour) comes from the worker; only the fast-changing connection-path
 * overlay runs on the main thread.
 */
export const useFlowEdges = (
  baseEdges: WorkerEdge[],
  highlightedConnectionEdgeKeys: ReadonlySet<string> = EMPTY_EDGE_KEYS,
): Edge[] => {
  return useMemo(() => {
    const hasConnectionPath = highlightedConnectionEdgeKeys.size > 0;

    return baseEdges.map(({ baseStyle, _highlightPairs, ...rest }) => {
      const isHighlighted = _highlightPairs.some((k) =>
        highlightedConnectionEdgeKeys.has(k),
      );
      return {
        ...rest,
        style: connectionStyle(baseStyle, isHighlighted, hasConnectionPath),
        animated: isHighlighted,
      } as Edge;
    });
  }, [baseEdges, highlightedConnectionEdgeKeys]);
};
