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

  const edgeStyle = {
    ...style,
    strokeWidth: selected ? 3 : 2,
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
