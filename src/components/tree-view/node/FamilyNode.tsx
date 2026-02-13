import { ChevronsDownUp, EyeIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { Member } from "@/types/member";
import { NODE_WIDTH } from "@/constants";
import { FamilyNodeContent } from "@/components/tree-view/node/FamilyNodeContent";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";

export const FamilyNode = ({ data, selected }: NodeProps<Node<Member>>) => {
  const { isFastMode } = useFamilyTreeSettings();

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

  const onAddChildClick = () => {
    if (data.onAddChild && typeof data.onAddChild === "function") {
      data.onAddChild();
    }
  };

  const onAddParentClick = () => {
    if (data.onAddParent && typeof data.onAddParent === "function") {
      data.onAddParent();
    }
  };

  const borderColor = selected ? "#2563eb" : "#777";
  const borderWidth = selected ? "2px" : "1px";

  return (
    <div
      className="relative flex flex-col items-center shadow-sm p-2 bg-white"
      style={{
        border: `${borderWidth} solid ${borderColor}`,
        borderRadius: "8px",
        width: `${NODE_WIDTH}px`,
        transition: "border 0.2s",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className={`${isFastMode ? "w-1/2!" : "w-1/4!"} bg-slate-400! rounded-md!`}
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

      {isFastMode && (
        <>
          <Button
            variant="ghost"
            className="absolute -top-6 left-1/2 -translate-x-1/2 translate-y-0.5 w-16 h-6 rounded-t-full rounded-b-none bg-white hover:bg-slate-100 z-10 p-0"
            style={{
              borderTop: `${borderWidth} solid ${borderColor}`,
              borderLeft: `${borderWidth} solid ${borderColor}`,
              borderRight: `${borderWidth} solid ${borderColor}`,
              borderBottom: "none",
            }}
            onClick={onAddParentClick}
          >
            <PlusIcon />
          </Button>
          <Button
            variant="ghost"
            className="absolute -bottom-6 left-1/2 -translate-x-1/2 -translate-y-0.5 w-16 h-6 rounded-b-full rounded-t-none bg-white hover:bg-slate-100 z-10 p-0"
            style={{
              borderBottom: `${borderWidth} solid ${borderColor}`,
              borderLeft: `${borderWidth} solid ${borderColor}`,
              borderRight: `${borderWidth} solid ${borderColor}`,
              borderTop: "none",
            }}
            onClick={onAddChildClick}
          >
            <PlusIcon />
          </Button>
        </>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className={`${isFastMode ? "w-1/2!" : "w-1/4!"} bg-slate-400! rounded-md!`}
      />
    </div>
  );
};
