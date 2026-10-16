import {
  ChevronsDownUp,
  ClipboardList,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  Activity,
  AlertTriangle,
  ShieldAlert,
  Dna,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { Member } from "@/types/member";
import { Disease } from "@/types/disease";
import { NODE_HEIGHT, NODE_WIDTH } from "@/constants";
import { FamilyNodeContent } from "@/components/view/tree-view/node/FamilyNodeContent";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useTranslation } from "react-i18next";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTaskStore } from "@/hooks/useTaskStore";

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
  const { isFastMode, isDiseaseMode, showTaskIndicators } =
    useFamilyTreeSettings();
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

  const onNodeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (data.isSelectionMode === true) return;
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
  const isSelectionMode = data.isSelectionMode === true;
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
  const hasOpenTasks = useTaskStore(
    (s) => showTaskIndicators && s.openTaskMemberIds.has(data.id),
  );
  // Connection handles: slim pills on the card edge, shown on hover/selection
  // (always in quick-add mode) so they don't clutter a resting tree.
  const handleVisibility =
    data.isReadOnly || isSelectionMode
      ? "pointer-events-none opacity-0!"
      : isFastMode || selected
        ? "opacity-100"
        : "opacity-0 group-hover:opacity-100";
  const handleClassName = `!h-1.5 !min-h-0 !w-10 !rounded-full !border-0 !bg-edge transition-opacity ${handleVisibility}`;
  const horizontalHandleClassName = `!w-1.5 !min-w-0 !h-8 !rounded-full !border-0 !bg-edge transition-opacity ${handleVisibility}`;

  const ringClass =
    isHighlighted || isConnectionSelected
      ? "ring-4 ring-primary/70 ring-offset-2 ring-offset-canvas"
      : !isConnectionSelected && isConnectionPath
        ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-canvas"
        : "";

  const showActions = !isSelectionMode;
  const indicators: ReactNode[] = [];
  if (isDiseaseMode && hasDiseases) {
    const label = `${t("disease-indicator", { count: data.diseases?.length || 0 })} · ${t(`disease-severity.${diseaseSeverity}`)}`;
    indicators.push(
      <span
        key="disease"
        className="grid size-5 place-items-center rounded-full border border-card"
        role="img"
        aria-label={label}
        title={label}
        style={{
          backgroundColor: hasAffectedDisease
            ? "var(--color-disease-affected-bg)"
            : hasCarrierDisease
              ? "var(--color-disease-carrier-bg)"
              : "var(--color-disease-other-bg)",
        }}
      >
        <DiseaseIcon
          aria-hidden="true"
          size={11}
          style={{
            color: hasAffectedDisease
              ? "var(--color-disease-affected)"
              : hasCarrierDisease
                ? "var(--color-disease-carrier)"
                : "var(--color-disease-other)",
          }}
        />
      </span>,
    );
  }
  if (hasRisk) {
    indicators.push(
      <span
        key="risk"
        className="grid size-5 place-items-center rounded-full border-2 border-dashed"
        role="img"
        aria-label={t("risk-indicator")}
        title={t("risk-indicator")}
        style={{
          backgroundColor: "var(--color-disease-risk-bg)",
          borderColor: "var(--color-disease-risk-border)",
        }}
      >
        <AlertTriangle
          aria-hidden="true"
          size={11}
          style={{ color: "var(--color-disease-risk)" }}
        />
      </span>,
    );
  }
  if (hasOpenTasks) {
    indicators.push(
      <span
        key="tasks"
        className="grid size-5 place-items-center rounded-full border bg-warning-soft"
        role="img"
        aria-label={t("task-indicator")}
        title={t("task-indicator")}
      >
        <ClipboardList aria-hidden="true" size={11} className="text-warning" />
      </span>,
    );
  }
  if (data.isCollapsed) {
    indicators.push(
      <span
        key="collapsed"
        className="grid size-5 place-items-center rounded-full border bg-card text-muted-foreground"
        aria-hidden="true"
      >
        <ChevronsDownUp size={11} />
      </span>,
    );
  }

  const quickAddClass =
    "absolute z-10 grid size-6 place-items-center rounded-full border-2 border-card bg-primary p-0 text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground";

  return (
    <div
      onKeyDown={onNodeKeyDown}
      className={[
        "group relative flex items-center rounded-2xl bg-card px-3 shadow-[0_1px_2px_rgba(41,33,20,0.07)] transition-[box-shadow,opacity,border-color] duration-200 hover:shadow-md",
        isConnectionDimmed ? "opacity-30" : "opacity-100",
        ringClass,
        selected && !ringClass
          ? "shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_22%,transparent)]"
          : "",
        isSelectionMode ? "select-none cursor-move" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        border: `${borderWidth} solid ${borderColor}`,
        width: `${NODE_WIDTH}px`,
        minHeight: `${NODE_HEIGHT}px`,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        isConnectable={!data.isReadOnly && !isSelectionMode}
        className={handleClassName}
        data-export-hide="true"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        isConnectable={!data.isReadOnly && !isSelectionMode}
        className={horizontalHandleClassName}
        data-export-hide="true"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectable={!data.isReadOnly && !isSelectionMode}
        className={horizontalHandleClassName}
        data-export-hide="true"
      />
      {isSelectionMode && (
        <div
          className="absolute -inset-2 z-20 cursor-move"
          aria-hidden="true"
        />
      )}

      <FamilyNodeContent
        member={data}
        disableNameLink={data.disableNameLink === true}
      />

      {showActions && (
        <div
          className={`absolute -top-4 right-3 z-10 flex items-center gap-0.5 rounded-full border bg-card p-0.5 shadow-sm transition-opacity ${
            selected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
          data-export-hide="true"
        >
          {typeof data.onView === "function" && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("view-details")}
              title={t("view-details")}
              className="nodrag nopan size-7 rounded-full"
              onPointerDown={stopCanvasGesture}
              onClick={onViewClick}
            >
              <EyeIcon />
            </Button>
          )}
          {!data.isReadOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("edit-member")}
              title={t("edit-member")}
              className="nodrag nopan size-7 rounded-full"
              onPointerDown={stopCanvasGesture}
              onClick={onEditClick}
            >
              <PencilIcon />
            </Button>
          )}
        </div>
      )}

      {indicators.length > 0 && (
        <div className="absolute -bottom-2.5 right-3 flex gap-1">
          {indicators}
        </div>
      )}

      {isFastMode && !data.isReadOnly && !isSelectionMode && (
        <div data-export-hide="true">
          <Button
            variant="ghost"
            aria-label={t("add-parent")}
            title={t("add-parent")}
            className={`${quickAddClass} -top-3 left-1/2 -translate-x-1/2`}
            onClick={onAddParentClick}
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            aria-label={t("add-child")}
            title={t("add-child")}
            className={`${quickAddClass} -bottom-3 left-1/2 -translate-x-1/2`}
            onClick={onAddChildClick}
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            aria-label={t("add-left")}
            title={t("add-left")}
            className={`${quickAddClass} -left-3 top-1/2 -translate-y-1/2`}
            onClick={onAddLeftClick}
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            aria-label={t("add-right")}
            title={t("add-right")}
            className={`${quickAddClass} -right-3 top-1/2 -translate-y-1/2`}
            onClick={onAddRightClick}
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        isConnectable={!data.isReadOnly && !isSelectionMode}
        className={handleClassName}
        data-export-hide="true"
      />
    </div>
  );
};
