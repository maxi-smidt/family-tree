import { Node, useReactFlow } from "@xyflow/react";
import { useState } from "react";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ListChevronsUpDown,
  Loader2,
  MoreHorizontal,
  Network,
  UserMinus,
  UserPlus,
  UserRoundPlus,
  Activity,
  ClipboardList,
  Crosshair,
  Minus,
  Plus,
} from "lucide-react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useFeature } from "@/hooks/useAuthStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { createMember, Member } from "@/types/member";
import { NODE_WIDTH } from "@/constants";
import { RelationControls } from "@/components/view/tree-view/RelationControls";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/ui/separator";

type Props = {
  nodes: Node[];
  selectedNodes: Node[];
  setMembersToDelete: (members: Member[]) => void;
  onEditMember: (member: Member) => void;
  onCreateNewMember: (member: Member) => void;
  onRearrange: () => void;
  readOnly?: boolean;
};

export const MemberControls = ({
  nodes,
  selectedNodes,
  setMembersToDelete,
  onCreateNewMember,
  onRearrange,
  readOnly = false,
}: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-view.controls" });
  const [isArrangeDialogOpen, setIsArrangeDialogOpen] = useState(false);
  const {
    isLockedScreen,
    isFastMode,
    setIsFastMode,
    isDiseaseMode,
    setIsDiseaseMode,
    showTaskIndicators,
    setShowTaskIndicators,
  } = useFamilyTreeSettings();
  const taskRestrictions = useTreeStore((s) => s.selectedTree?.restrictions);
  const tasksEnabled =
    useFeature("research_tasks") && !taskRestrictions?.includes("tasks");
  const {
    batchSetCollapsed,
    windowed,
    isLayouting,
    neighborhoodUp,
    neighborhoodDown,
    setFocusRoot,
    setNeighborhoodDepth,
  } = useMemberStore();
  const { screenToFlowPosition } = useReactFlow();
  const canFocusHere = windowed && selectedNodes.length === 1;
  const canAdjustDepth = windowed;
  const hasOverflowActions = canAdjustDepth || canFocusHere || tasksEnabled;

  return (
    <div className="flex flex-col gap-2">
      {/* Relations — hidden in read-only (virtual view) mode */}
      {!readOnly && <RelationControls />}

      {!readOnly && <Separator className="my-1" />}

      {/* View Modes */}
      <ButtonGroup orientation="vertical">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isFastMode ? "default" : "secondary"}
              size="icon"
              onClick={() => setIsFastMode(!isFastMode)}
              disabled={isLockedScreen}
              aria-label={
                isFastMode ? t("disable-quick-add") : t("enable-quick-add")
              }
            >
              <UserRoundPlus className={isFastMode ? "fill-current" : ""} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {isFastMode ? t("disable-quick-add") : t("enable-quick-add")}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isDiseaseMode ? "default" : "secondary"}
              size="icon"
              onClick={() => setIsDiseaseMode(!isDiseaseMode)}
              disabled={isLockedScreen}
              aria-label={
                isDiseaseMode
                  ? t("disable-disease-mode")
                  : t("enable-disease-mode")
              }
            >
              <Activity className={isDiseaseMode ? "fill-current" : ""} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {isDiseaseMode
              ? t("disable-disease-mode")
              : t("enable-disease-mode")}
          </TooltipContent>
        </Tooltip>
      </ButtonGroup>

      <Separator className="my-1" />

      {/* Collapse/Expand Controls */}
      <ButtonGroup orientation="vertical">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              onClick={onCollapseMembers}
              disabled={selectedNoExpandedMember()}
              aria-label={t("collapse-children")}
            >
              <ChevronsDownUp />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t("collapse-children")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              onClick={onExpandMembers}
              disabled={selectedNoCollapsedMember()}
              aria-label={t("expand-children")}
            >
              <ChevronsUpDown />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t("expand-children")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              onClick={onExpandAllMembers}
              disabled={noCollapsedMember()}
              aria-label={t("expand-all-children")}
            >
              <ListChevronsUpDown />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {t("expand-all-children")}
          </TooltipContent>
        </Tooltip>
      </ButtonGroup>

      {!readOnly && <Separator className="my-1" />}

      {/* Member Add/Remove — hidden in read-only (virtual view) mode */}
      {!readOnly && (
        <ButtonGroup orientation="vertical">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                onClick={onAddMember}
                disabled={isLockedScreen}
                aria-label={t("add-person")}
                className="text-green-600 hover:bg-green-50 hover:text-green-700"
                data-tutorial="add-member"
              >
                <UserPlus size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{t("add-person")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                onClick={onRemoveMembers}
                disabled={!selectedNodes.length || isLockedScreen}
                aria-label={t("remove-person")}
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                <UserMinus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{t("remove-person")}</TooltipContent>
          </Tooltip>
        </ButtonGroup>
      )}

      <Separator className="my-1" />

      {/* Layout + situational actions */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                aria-label={t("more-actions")}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">{t("more-actions")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="left" align="end">
          <DropdownMenuItem
            onSelect={() => setIsArrangeDialogOpen(true)}
            disabled={isLockedScreen || isLayouting}
          >
            {isLayouting ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Network />
            )}
            {t("arrange-members")}
          </DropdownMenuItem>
          {hasOverflowActions && (
            <>
              {tasksEnabled && (
                <DropdownMenuCheckboxItem
                  checked={showTaskIndicators}
                  onCheckedChange={setShowTaskIndicators}
                  onSelect={(e) => e.preventDefault()}
                >
                  <ClipboardList
                    className={showTaskIndicators ? "fill-current" : ""}
                  />
                  {showTaskIndicators
                    ? t("disable-task-indicators")
                    : t("enable-task-indicators")}
                </DropdownMenuCheckboxItem>
              )}
              {canAdjustDepth && (
                <>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      void setNeighborhoodDepth(
                        Math.min(neighborhoodUp + 1, 10),
                        Math.min(neighborhoodDown + 1, 10),
                      );
                    }}
                  >
                    <Plus />
                    {t("depth-increase")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      void setNeighborhoodDepth(
                        Math.max(neighborhoodUp - 1, 1),
                        Math.max(neighborhoodDown - 1, 1),
                      );
                    }}
                    disabled={neighborhoodUp <= 1 && neighborhoodDown <= 1}
                  >
                    <Minus />
                    {t("depth-decrease")}
                  </DropdownMenuItem>
                </>
              )}
              {canFocusHere && (
                <DropdownMenuItem
                  onSelect={() => void setFocusRoot(selectedNodes[0].id)}
                >
                  <Crosshair />
                  {t("focus-here")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={isArrangeDialogOpen}
        onOpenChange={setIsArrangeDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("arrange-confirm-title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("arrange-confirm-description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("arrange-confirm-cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onRearrange}
              disabled={isLockedScreen || isLayouting}
            >
              {t("arrange-confirm-confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  async function onAddMember() {
    const NODE_HEIGHT = 157;
    const BOTTOM_MARGIN = 50;
    const flowPoint = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight - BOTTOM_MARGIN - NODE_HEIGHT,
    });

    const position = {
      x: flowPoint.x - NODE_WIDTH / 2,
      y: flowPoint.y,
    };

    const newMember = createMember(position);
    onCreateNewMember(newMember);
  }

  function onRemoveMembers() {
    setMembersToDelete(selectedNodes.map((node) => node.data as Member));
  }

  function onExpandMembers() {
    batchSetCollapsed(
      selectedNodes.map((n) => ({ id: n.id, isCollapsed: false })),
    );
  }

  function onExpandAllMembers() {
    batchSetCollapsed(nodes.map((n) => ({ id: n.id, isCollapsed: false })));
  }

  function onCollapseMembers() {
    batchSetCollapsed(
      selectedNodes.map((n) => ({ id: n.id, isCollapsed: true })),
    );
  }

  function selectedNoCollapsedMember() {
    return selectedNodes.every((node) => !node.data.isCollapsed);
  }

  function selectedNoExpandedMember() {
    return selectedNodes.every((node) => node.data.isCollapsed);
  }

  function noCollapsedMember() {
    return nodes.every((node) => !node.data.isCollapsed);
  }
};
