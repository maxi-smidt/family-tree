import { useState } from "react";
import {
  ChevronsDownUp,
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  PencilOffIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailFamilyNode } from "@/components/node/DetailFamilyNode";
import { EditFamilyNode } from "@/components/node/EditFamilyNode";
import { DefaultFamilyNode } from "@/components/node/DefaultFamilyNode";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { Member } from "@/types/member";
import { NODE_WIDTH } from "../../../constants.json";

export const FamilyNode = ({ data, selected }: NodeProps<Node<Member>>) => {
  const [editMode, setEditMode] = useState(false);
  const [detailMode, setDetailMode] = useState(false);

  const toggleEditMode = () => {
    if (!editMode) {
      setDetailMode(false);
    }
    setEditMode(!editMode);
  };

  const toggleDetailMode = () => {
    if (!detailMode) {
      setEditMode(false);
    }
    setDetailMode(!detailMode);
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
        id="left"
        className="left-1/4!"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="right"
        className="left-3/4!"
      />
      <div className="absolute top-2 flex justify-between w-full px-2">
        <Button variant="outline" size="icon-sm" onClick={toggleDetailMode}>
          {detailMode ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
        <Button variant="outline" size="icon-sm" onClick={toggleEditMode}>
          {editMode ? <PencilOffIcon /> : <PencilIcon />}
        </Button>
      </div>

      {detailMode && <DetailFamilyNode member={data} />}

      {editMode && <EditFamilyNode member={data} />}

      {!editMode && !detailMode && <DefaultFamilyNode member={data} />}

      {data.isCollapsed && (
        <div className="absolute bottom-1 right-1">
          <ChevronsDownUp size="14" />
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};
