import {
  ChevronsDownUp,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  Activity,
  AlertTriangle,
  ShieldAlert,
  Dna,
  Network,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { Member } from "@/types/member";
import { Disease } from "@/types/disease";
import { NODE_WIDTH } from "@/constants";
import { FamilyNodeContent } from "@/components/view/tree-view/node/FamilyNodeContent";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useTranslation } from "react-i18next";
import { useMemberStore } from "@/hooks/useMemberStore";

// Returns true if this disease implies genetic risk for the child, given which
// parent it comes from and whether the other parent also carries the same condition.
function diseaseImpliesRisk(
  disease: Disease,
  fromPaternal: boolean,
  bothParentsHave: boolean,
  childGender: Member["gender"],
): boolean {
  const isAffected = disease.carrierStatus === "affected";

  switch (disease.inheritancePattern) {
    case "autosomal_dominant":
    case "x_linked_dominant":
    case "multifactorial":
      // 50% transmission from any affected parent
      return isAffected;

    case "autosomal_recessive":
      // Meaningful risk only when both parents carry the same condition
      return bothParentsHave;

    case "x_linked_recessive":
      if (!fromPaternal) {
        // Carrier/affected mother: male children always at risk; female children
        // need an affected father too (to receive a second X^a allele)
        return childGender === "m" || childGender === "o" || bothParentsHave;
      }
      // Affected father: daughters get his X^a but are only at risk if the
      // mother also carries the allele; sons receive Y from father — no risk
      return childGender !== "m" && bothParentsHave;

    case "y_linked":
      // Transmitted from father to sons only
      return fromPaternal && isAffected && childGender !== "f";

    case "mitochondrial":
      // Maternally inherited — all children of an affected/carrier mother are at risk
      return !fromPaternal;

    case "unknown":
    default:
      // Conservative fallback: flag any recorded carrier or affected parent
      return isAffected || disease.carrierStatus === "carrier";
  }
}

function calculateDiseaseRisk(member: Member, allMembers: Member[]): boolean {
  if (member.diseases && member.diseases.length > 0) return false;

  const paternalParent = member.parents.paternalParent
    ? allMembers.find((m) => m.id === member.parents.paternalParent)
    : null;
  const maternalParent = member.parents.maternalParent
    ? allMembers.find((m) => m.id === member.parents.maternalParent)
    : null;

  const paternalDiseases = paternalParent?.diseases ?? [];
  const maternalDiseases = maternalParent?.diseases ?? [];

  if (paternalDiseases.length === 0 && maternalDiseases.length === 0)
    return false;

  const gender = member.gender;

  const check = (disease: Disease, fromPaternal: boolean): boolean => {
    const otherSide = fromPaternal ? maternalDiseases : paternalDiseases;
    const bothParentsHave = otherSide.some((d) => d.name === disease.name);
    return diseaseImpliesRisk(disease, fromPaternal, bothParentsHave, gender);
  };

  return (
    paternalDiseases.some((d) => check(d, true)) ||
    maternalDiseases.some((d) => check(d, false))
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

  const onOpenLinkedTreeClick = (event: MouseEvent<HTMLButtonElement>) => {
    stopCanvasGesture(event);
    if (data.onOpenLinkedTree && typeof data.onOpenLinkedTree === "function") {
      data.onOpenLinkedTree();
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

  const onNodeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      // Only activate if the event target is the node wrapper itself (not a button inside)
      if (e.target === e.currentTarget) {
        e.preventDefault();
        if (data.onView && typeof data.onView === "function") {
          data.onView();
        }
      }
    }
  };

  // Use CSS variables for theme-aware colors
  const isConnectionSelected = data.isConnectionSelected === true;
  const isConnectionPath = data.isConnectionPath === true;
  const isConnectionDimmed = data.isConnectionDimmed === true;
  const borderColor =
    selected || isConnectionSelected
      ? "var(--primary)"
      : isConnectionPath
        ? "var(--connection-path)"
        : "var(--border)";
  const borderWidth =
    selected || isConnectionSelected || isConnectionPath ? "2px" : "1px";

  // Briefly highlighted after being located via canvas search.
  const isHighlighted = data.isHighlighted === true;

  const hasDiseases = data.diseases && data.diseases.length > 0;
  const hasAffectedDisease = data.diseases?.some(
    (d) => d.carrierStatus === "affected",
  );
  const hasCarrierDisease = data.diseases?.some(
    (d) => d.carrierStatus === "carrier",
  );

  const diseaseSeverity = hasAffectedDisease
    ? "affected"
    : hasCarrierDisease
      ? "carrier"
      : "other";
  const DiseaseIcon =
    diseaseSeverity === "affected"
      ? ShieldAlert
      : diseaseSeverity === "carrier"
        ? Dna
        : Activity;

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
      onKeyDown={onNodeKeyDown}
      className={[
        "relative flex flex-col items-center shadow-sm p-2 bg-card transition-opacity duration-200",
        isConnectionDimmed ? "opacity-30" : "opacity-100",
        isHighlighted || isConnectionSelected
          ? "ring-4 ring-primary ring-offset-2 ring-offset-background"
          : "",
        !isConnectionSelected && isConnectionPath
          ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-background"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        border: `${borderWidth} solid ${borderColor}`,
        borderRadius: "8px",
        width: `${NODE_WIDTH}px`,
        transition: "border 0.2s, box-shadow 0.2s, opacity 0.2s",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        isConnectable={!data.isReadOnly}
        className={handleClassName}
        data-export-hide="true"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        isConnectable={!data.isReadOnly}
        className={horizontalHandleClassName}
        data-export-hide="true"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectable={!data.isReadOnly}
        className={horizontalHandleClassName}
        data-export-hide="true"
      />
      <div className="absolute top-2 flex justify-between w-full px-2" data-export-hide="true">
        <div className="flex gap-1">
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
          {typeof data.onOpenLinkedTree === "function" && (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("open-linked-tree")}
              title={t("open-linked-tree")}
              className="nodrag nopan"
              onPointerDown={stopCanvasGesture}
              onClick={onOpenLinkedTreeClick}
            >
              <Network />
            </Button>
          )}
        </div>
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
          role="img"
          aria-label={`${t("disease-indicator", { count: data.diseases?.length || 0 })} · ${t(`disease-severity.${diseaseSeverity}`)}`}
          style={{
            backgroundColor: hasAffectedDisease
              ? "var(--color-disease-affected-bg)"
              : hasCarrierDisease
                ? "var(--color-disease-carrier-bg)"
                : "var(--color-disease-other-bg)",
          }}
          title={`${t("disease-indicator", { count: data.diseases?.length || 0 })} · ${t(`disease-severity.${diseaseSeverity}`)}`}
        >
          <DiseaseIcon
            aria-hidden="true"
            size={12}
            style={{
              color: hasAffectedDisease
                ? "var(--color-disease-affected)"
                : hasCarrierDisease
                  ? "var(--color-disease-carrier)"
                  : "var(--color-disease-other)",
            }}
          />
        </div>
      )}

      {/* Risk indicator - shown only in disease mode when person doesn't have diseases but parents do */}
      {hasRisk && (
        <div
          className="absolute bottom-2 left-2 rounded-full p-1 border-2 border-dashed"
          role="img"
          aria-label={t("risk-indicator")}
          style={{
            backgroundColor: "var(--color-disease-risk-bg)",
            borderColor: "var(--color-disease-risk-border)",
          }}
          title={t("risk-indicator")}
        >
          <AlertTriangle
            aria-hidden="true"
            size={12}
            style={{
              color: "var(--color-disease-risk)",
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
        <div data-export-hide="true">
          <Button
            variant="ghost"
            aria-label={t("add-parent")}
            className="absolute -top-6 left-1/2 -translate-x-1/2 translate-y-0.5 w-16 h-6 rounded-t-full rounded-b-none bg-muted-foreground hover:bg-muted-foreground/80 z-10 p-0"
            style={{
              borderTop: `${borderWidth} solid ${borderColor}`,
              borderLeft: `${borderWidth} solid ${borderColor}`,
              borderRight: `${borderWidth} solid ${borderColor}`,
              borderBottom: "none",
            }}
            onClick={onAddParentClick}
          >
            <PlusIcon className="text-card" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            aria-label={t("add-child")}
            className="absolute -bottom-6 left-1/2 -translate-x-1/2 -translate-y-0.5 w-16 h-6 rounded-b-full rounded-t-none bg-muted-foreground hover:bg-muted-foreground/80 z-10 p-0"
            style={{
              borderBottom: `${borderWidth} solid ${borderColor}`,
              borderLeft: `${borderWidth} solid ${borderColor}`,
              borderRight: `${borderWidth} solid ${borderColor}`,
              borderTop: "none",
            }}
            onClick={onAddChildClick}
          >
            <PlusIcon className="text-card" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            aria-label={t("add-left")}
            className="absolute -left-6 top-1/2 -translate-y-1/2 translate-x-0.5 h-16 w-6 rounded-l-full rounded-r-none bg-muted-foreground hover:bg-muted-foreground/80 z-10 p-0"
            style={{
              borderLeft: `${borderWidth} solid ${borderColor}`,
              borderTop: `${borderWidth} solid ${borderColor}`,
              borderBottom: `${borderWidth} solid ${borderColor}`,
              borderRight: "none",
            }}
            onClick={onAddLeftClick}
          >
            <PlusIcon className="text-card" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            aria-label={t("add-right")}
            className="absolute -right-6 top-1/2 -translate-y-1/2 -translate-x-0.5 h-16 w-6 rounded-r-full rounded-l-none bg-muted-foreground hover:bg-muted-foreground/80 z-10 p-0"
            style={{
              borderRight: `${borderWidth} solid ${borderColor}`,
              borderTop: `${borderWidth} solid ${borderColor}`,
              borderBottom: `${borderWidth} solid ${borderColor}`,
              borderLeft: "none",
            }}
            onClick={onAddRightClick}
          >
            <PlusIcon className="text-card" aria-hidden="true" />
          </Button>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        isConnectable={!data.isReadOnly}
        className={handleClassName}
        data-export-hide="true"
      />
    </div>
  );
};
