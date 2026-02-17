import {
  ChevronsDownUp,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  Activity,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { Member } from "@/types/member";
import { NODE_WIDTH } from "@/constants";
import { FamilyNodeContent } from "@/components/view/tree-view/node/FamilyNodeContent";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useTranslation } from "react-i18next";
import { useMemberStore } from "@/hooks/useMemberStore";

// Helper to calculate if a child might be at risk based on parent diseases
function calculateDiseaseRisk(member: Member, allMembers: Member[]): boolean {
  // If member already has diseases recorded, return false (we'll show actual disease indicator)
  if (member.diseases && member.diseases.length > 0) {
    return false;
  }

  // Check if any parent has diseases
  const parents: Member[] = [];
  if (member.parents.paternalParent) {
    const parent = allMembers.find(
      (m) => m.id === member.parents.paternalParent,
    );
    if (parent) parents.push(parent);
  }
  if (member.parents.maternalParent) {
    const parent = allMembers.find(
      (m) => m.id === member.parents.maternalParent,
    );
    if (parent) parents.push(parent);
  }

  return parents.some(
    (parent) => parent.diseases && parent.diseases.length > 0,
  );
}

export const FamilyNode = ({ data, selected }: NodeProps<Node<Member>>) => {
  const { isFastMode, isDiseaseMode } = useFamilyTreeSettings();
  const { members } = useMemberStore();
  const { t } = useTranslation(undefined, {
    keyPrefix: "tree-view.node",
  });

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

  const hasDiseases = data.diseases && data.diseases.length > 0;
  const hasAffectedDisease = data.diseases?.some(
    (d) => d.carrierStatus === "affected",
  );
  const hasCarrierDisease = data.diseases?.some(
    (d) => d.carrierStatus === "carrier",
  );

  // Calculate if this person has potential disease risk from parents
  const hasRisk = isDiseaseMode && calculateDiseaseRisk(data, members);

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

      {/* Disease indicator - shown only in disease mode when person has recorded diseases */}
      {isDiseaseMode && hasDiseases && (
        <div
          className="absolute bottom-2 left-2 rounded-full p-1"
          style={{
            backgroundColor: hasAffectedDisease
              ? "rgba(239, 68, 68, 0.15)"
              : hasCarrierDisease
                ? "rgba(251, 191, 36, 0.15)"
                : "rgba(156, 163, 175, 0.15)",
          }}
          title={t("disease-indicator", { count: data.diseases?.length || 0 })}
        >
          <Activity
            size={12}
            style={{
              color: hasAffectedDisease
                ? "rgb(239, 68, 68)"
                : hasCarrierDisease
                  ? "rgb(251, 191, 36)"
                  : "rgb(156, 163, 175)",
            }}
          />
        </div>
      )}

      {/* Risk indicator - shown only in disease mode when person doesn't have diseases but parents do */}
      {hasRisk && (
        <div
          className="absolute bottom-2 left-2 rounded-full p-1 border-2 border-dashed"
          style={{
            backgroundColor: "rgba(234, 179, 8, 0.1)",
            borderColor: "rgba(234, 179, 8, 0.5)",
          }}
          title={t("risk-indicator")}
        >
          <AlertTriangle
            size={12}
            style={{
              color: "rgb(234, 179, 8)",
            }}
          />
        </div>
      )}

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
