import {
  BaseEdge,
  Edge,
  EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
} from "@xyflow/react";
import { NODE_HEIGHT } from "@/constants";
import { UNION_NODE_SIZE } from "@/components/view/tree-view/node/UnionNode";

export type UnionChildEdgeData = {
  /** The user's chosen line style: "default" | "straight" | "step" | "smoothstep". */
  lineType?: string;
};

/**
 * Height of the step bend for a connector from a union dot down to a child.
 * The dot sits at the parents' mid-height, so React Flow's default bend
 * (halfway between the dot and the child) lands closer to the parents. This
 * measures from the parents' bottom edge instead, so the bend sits centered
 * in the gap between the two rows. Returns undefined when the child is not
 * below the parents, leaving React Flow's own routing in place.
 */
export function getUnionChildCenterY(
  sourceY: number,
  targetY: number,
): number | undefined {
  // The bottom handle sits half a dot below the parents' mid-height.
  const parentBottom = sourceY - UNION_NODE_SIZE / 2 + NODE_HEIGHT / 2;
  if (targetY <= parentBottom) return undefined;
  return (parentBottom + targetY) / 2;
}

export const UnionChildEdge = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
  interactionWidth,
}: EdgeProps<Edge<UnionChildEdgeData>>) => {
  const lineType = data?.lineType ?? "step";
  let edgePath: string;

  if (lineType === "straight") {
    [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  } else if (lineType === "default") {
    [edgePath] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  } else {
    [edgePath] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: lineType === "step" ? 0 : undefined,
      centerY: getUnionChildCenterY(sourceY, targetY),
    });
  }

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth}
    />
  );
};
