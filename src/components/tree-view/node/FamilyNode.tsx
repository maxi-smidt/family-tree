import { ChevronsDownUp, EyeIcon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { Member } from "@/types/member";
import { NODE_WIDTH } from "../../../../constants.json";
import { FamilyNodeContent } from "@/components/tree-view/node/FamilyNodeContent";

export const FamilyNode = ({ data, selected }: NodeProps<Node<Member>>) => {
  const onEditClick = () => {
    if (data.onEdit && typeof data.onEdit === "function") {
      data.onEdit();
    }
  };

  const onViewClick = () => {
    if (data.onView && typeof data.onView === "function") {
      data.onView();
    }
  };

  return (
    <div
      className="relative flex flex-col items-center shadow-sm p-2 bg-white"
      style={{
        border: selected ? "2px solid #2563eb" : "1px solid #777",
        borderRadius: "8px",
        width: `${NODE_WIDTH}px`,
        transition: "border 0.2s",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="w-1/4! bg-slate-400! rounded-md!"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className="h-1/4! w-2! bg-slate-400! rounded-md!"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="h-1/4! w-2! bg-slate-400! rounded-md!"
      />
      <div className="absolute top-2 flex justify-between w-full px-2">
        <Button variant="outline" size="icon-sm" onClick={onViewClick}>
          <EyeIcon />
        </Button>
        <Button variant="outline" size="icon-sm" onClick={onEditClick}>
          <PencilIcon />
        </Button>
      </div>

      <FamilyNodeContent member={data} />

      {data.isCollapsed && (
        <div className="absolute bottom-1 right-1">
          <ChevronsDownUp size="14" />
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="w-1/4! bg-slate-400! rounded-md!"
      />
    </div>
  );
};
