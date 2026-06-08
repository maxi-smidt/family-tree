import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { UnionInfo } from "@/hooks/useFlowUnions";

export const UNION_NODE_SIZE = 10;

export const UnionNode = ({ data }: NodeProps<Node<UnionInfo>>) => {
  const isConnectionPath = data.isConnectionPath === true;
  const isConnectionDimmed = data.isConnectionDimmed === true;
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
        backgroundColor: isConnectionPath ? "hsl(45 93% 47%)" : color,
        boxShadow: isConnectionPath ? "0 0 0 4px hsl(45 93% 47% / 0.22)" : "",
        opacity: isConnectionDimmed ? 0.25 : 1,
        transition: "background-color 0.2s, box-shadow 0.2s, opacity 0.2s",
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
