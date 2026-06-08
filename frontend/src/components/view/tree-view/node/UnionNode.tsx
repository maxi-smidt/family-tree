import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { UnionInfo } from "@/hooks/useFlowUnions";

export const UNION_NODE_SIZE = 10;

export const UnionNode = ({ data }: NodeProps<Node<UnionInfo>>) => {
  const color =
    data.relationType === "married"
      ? "hsl(142 76% 36%)"
      : data.relationType === "divorced"
        ? "var(--destructive)"
        : data.relationType === "partner"
          ? "hsl(217 91% 60%)"
          : "var(--muted-foreground)";

  return (
    <div
      style={{
        width: UNION_NODE_SIZE,
        height: UNION_NODE_SIZE,
        borderRadius: "50%",
        backgroundColor: color,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{ opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ opacity: 0 }}
      />
    </div>
  );
};
