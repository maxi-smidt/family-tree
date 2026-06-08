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
import { MouseEvent, PointerEvent } from "react";
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

  const stopCanvasGesture = (event: PointerEvent | MouseEvent) => {
    event.stopPropagation();
  };

  const onEditClick = (event: MouseEvent<HTMLButtonElement>) => {
    stopCanvasGesture(event);
    if (data.onEdit && typeof data.onEdit === "function") {
      data.onEdit();
    }
  };

  const onViewClick = (event: MouseEvent<HTMLButtonElement>) => {
    stopCanvasGesture(event);
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

  const onAddLeftClick = () => {
    if (data.onAddLeft && typeof data.onAddLeft === "function") {
      data.onAddLeft();
    }
  };

  const onAddRightClick = () => {
    if (data.onAddRight && typeof data.onAddRight === "function") {
      data.onAddRight();
    }
  };

  // Use CSS variables for theme-aware colors
  const borderColor = selected ? "var(--primary)" : "var(--border)";
  const borderWidth = selected ? "2px" : "1px";

  // Briefly highlighted after being located via canvas search.
  const isHighlighted = data.isHighlighted === true;

  const hasDiseases = data.diseases && data.diseases.length > 0;
  const hasAffectedDisease = data.diseases?.some(
    (d) => d.carrierStatus === "affected",
  );
  const hasCarrierDisease = data.diseases?.some(
    (d) => d.carrierStatus === "carrier",
  );

  // Calculate if this person has potential disease risk from parents
  const hasRisk = isDiseaseMode && calculateDiseaseRisk(data, members);
  const handleClassName = `${
    isFastMode ? "w-1/2!" : "w-1/4!"
  } bg-muted-foreground! rounded-md! ${
    data.isReadOnly ? "pointer-events-none opacity-0" : ""
  }`;
  const horizontalHandleClassName = `${
    isFastMode ? "h-3/5!" : "h-1/4!"
  } bg-muted-foreground! rounded-md! ${
    data.isReadOnly ? "pointer-events-none opacity-0" : ""
  }`;

  return (
    <div
      className={`relative flex flex-col items-center shadow-sm p-2 bg-card ${
        isHighlighted
          ? "ring-4 ring-primary ring-offset-2 ring-offset-background"
          : ""
      }`}
      style={{
        border: `${borderWidth} solid ${borderColor}`,
        borderRadius: "8px",
        width: `${NODE_WIDTH}px`,
        transition: "border 0.2s, box-shadow 0.2s",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        isConnectable={!data.isReadOnly}
        className={handleClassName}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        isConnectable={!data.isReadOnly}
        className={horizontalHandleClassName}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectable={!data.isReadOnly}
        className={horizontalHandleClassName}
      />
      <div className="absolute top-2 flex justify-between w-full px-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("view-details")}
          className="nodrag nopan"
          onPointerDown={stopCanvasGesture}
          onClick={onViewClick}
        >
          <EyeIcon />
        </Button>
        {!data.isReadOnly && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("edit-member")}
            className="nodrag nopan"
            onPointerDown={stopCanvasGesture}
            onClick={onEditClick}
          >
            <PencilIcon />
          </Button>
        )}
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

      {isFastMode && !data.isReadOnly && (
        <>
          <Button
            variant="ghost"
            className="absolute -top-6 left-1/2 -translate-x-1/2 translate-y-0.5 w-16 h-6 rounded-t-full rounded-b-none bg-muted-foreground hover:bg-muted-foreground/80 z-10 p-0"
            style={{
              borderTop: `${borderWidth} solid ${borderColor}`,
              borderLeft: `${borderWidth} solid ${borderColor}`,
              borderRight: `${borderWidth} solid ${borderColor}`,
              borderBottom: "none",
            }}
            onClick={onAddParentClick}
          >
            <PlusIcon className="text-card" />
          </Button>
          <Button
            variant="ghost"
            className="absolute -bottom-6 left-1/2 -translate-x-1/2 -translate-y-0.5 w-16 h-6 rounded-b-full rounded-t-none bg-muted-foreground hover:bg-muted-foreground/80 z-10 p-0"
            style={{
              borderBottom: `${borderWidth} solid ${borderColor}`,
              borderLeft: `${borderWidth} solid ${borderColor}`,
              borderRight: `${borderWidth} solid ${borderColor}`,
              borderTop: "none",
            }}
            onClick={onAddChildClick}
          >
            <PlusIcon className="text-card" />
          </Button>
          <Button
            variant="ghost"
            className="absolute -left-6 top-1/2 -translate-y-1/2 translate-x-0.5 h-16 w-6 rounded-l-full rounded-r-none bg-muted-foreground hover:bg-muted-foreground/80 z-10 p-0"
            style={{
              borderLeft: `${borderWidth} solid ${borderColor}`,
              borderTop: `${borderWidth} solid ${borderColor}`,
              borderBottom: `${borderWidth} solid ${borderColor}`,
              borderRight: "none",
            }}
            onClick={onAddLeftClick}
          >
            <PlusIcon className="text-card" />
          </Button>
          <Button
            variant="ghost"
            className="absolute -right-6 top-1/2 -translate-y-1/2 -translate-x-0.5 h-16 w-6 rounded-r-full rounded-l-none bg-muted-foreground hover:bg-muted-foreground/80 z-10 p-0"
            style={{
              borderRight: `${borderWidth} solid ${borderColor}`,
              borderTop: `${borderWidth} solid ${borderColor}`,
              borderBottom: `${borderWidth} solid ${borderColor}`,
              borderLeft: "none",
            }}
            onClick={onAddRightClick}
          >
            <PlusIcon className="text-card" />
          </Button>
        </>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        isConnectable={!data.isReadOnly}
        className={handleClassName}
      />
    </div>
  );
};
