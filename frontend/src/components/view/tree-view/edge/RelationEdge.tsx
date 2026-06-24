import { BaseEdge, EdgeProps, getStraightPath } from "@xyflow/react";

export const RelationEdge = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  style = {},
  markerEnd,
  selected,
  interactionWidth = 40,
}: EdgeProps) => {
  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const baseWidth =
    typeof style?.strokeWidth === "number" ? style.strokeWidth : 2;
  const edgeStyle = {
    ...style,
    strokeWidth: selected ? 3 : baseWidth,
    filter: selected ? "brightness(0.5)" : "none",
  };

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      style={edgeStyle}
      interactionWidth={interactionWidth}
    />
  );
};
