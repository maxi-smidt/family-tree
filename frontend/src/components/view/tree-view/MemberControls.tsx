import { Node, useReactFlow } from "@xyflow/react";
import { ReactNode, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ListChevronsUpDown,
  Loader2,
  Network,
  UserMinus,
  UserPlus,
  UserRoundPlus,
  Activity,
  ClipboardList,
  Crosshair,
  FolderTree,
  Minus,
  Plus,
} from "lucide-react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { createMember, Member } from "@/types/member";
import { NODE_HEIGHT, NODE_WIDTH } from "@/constants";
import { RelationControls } from "@/components/view/tree-view/RelationControls";
import { PanelMoreMenu } from "@/components/view/tree-view/PanelMoreMenu";
import {
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/view/tree-view/CanvasToolbar";
import { CreateSectionDialog } from "@/components/view/tree-view/nav/CreateSectionDialog";
import { useTranslation } from "react-i18next";
import { stepNeighborhoodDepth } from "@/types/savedView";
import { ShortcutHint } from "@/components/ui/shortcut-hint";

type Props = {
  nodes: Node[];
  selectedNodes: Node[];
  setMembersToDelete: (members: Member[]) => void;
  onEditMember: (member: Member) => void;
  onCreateNewMember: (member: Member) => void;
  onRearrange: () => void;
  readOnly?: boolean;
  /** Items from FlowPanelControls, listed first in the shared overflow menu. */
  leadingMenuItems?: ReactNode;
};

export const MemberControls = ({
  nodes,
  selectedNodes,
  setMembersToDelete,
  onCreateNewMember,
  onRearrange,
  readOnly = false,
  leadingMenuItems,
}: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-view.controls" });
  const [isArrangeDialogOpen, setIsArrangeDialogOpen] = useState(false);
  const [isCreateSectionOpen, setIsCreateSectionOpen] = useState(false);
  const canCreateSections = useWorkspaceStore(
    (s) =>
      s.selectedTree?.can_create_sections ?? s.selectedTree?.role === "owner",
  );
  const {
    isLockedScreen,
    isFastMode,
    setIsFastMode,
    isDiseaseMode,
    setIsDiseaseMode,
    showTaskIndicators,
    setShowTaskIndicators,
  } = useFamilyTreeSettings();
  const taskRestrictions = useWorkspaceStore(
    (s) => s.selectedTree?.restrictions,
  );
  const tasksEnabled = !taskRestrictions?.includes("tasks");
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

  const adjustNeighborhoodDepth = (delta: 1 | -1) => (e: Event) => {
    e.preventDefault();
    void setNeighborhoodDepth(
      stepNeighborhoodDepth(neighborhoodUp, delta, 10),
      stepNeighborhoodDepth(neighborhoodDown, delta, 10),
    );
  };

  return (
    <>
      <ToolbarGroup>
        {/* Relations — hidden in read-only (virtual view) mode */}
        {!readOnly && <RelationControls />}

        {/* View Modes */}
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarButton
              active={isFastMode}
              onClick={() => setIsFastMode(!isFastMode)}
              disabled={isLockedScreen}
              aria-label={
                isFastMode ? t("disable-quick-add") : t("enable-quick-add")
              }
            >
              <UserRoundPlus className={isFastMode ? "fill-current" : ""} />
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isFastMode ? t("disable-quick-add") : t("enable-quick-add")}
          </TooltipContent>
        </Tooltip>
      </ToolbarGroup>
      <ToolbarSeparator />

      {/* Collapse/Expand Controls */}
      <ToolbarGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarButton
              onClick={onCollapseMembers}
              disabled={selectedNoExpandedMember()}
              aria-label={t("collapse-children")}
            >
              <ChevronsDownUp />
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent side="top">{t("collapse-children")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarButton
              onClick={onExpandMembers}
              disabled={selectedNoCollapsedMember()}
              aria-label={t("expand-children")}
            >
              <ChevronsUpDown />
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent side="top">{t("expand-children")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarButton
              onClick={onExpandAllMembers}
              disabled={noCollapsedMember()}
              aria-label={t("expand-all-children")}
            >
              <ListChevronsUpDown />
            </ToolbarButton>
          </TooltipTrigger>
          <TooltipContent side="top">{t("expand-all-children")}</TooltipContent>
        </Tooltip>
      </ToolbarGroup>

      {/* Member Add/Remove — hidden in read-only (virtual view) mode */}
      {!readOnly && (
        <>
          <ToolbarSeparator />
          <ToolbarGroup>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToolbarButton
                  onClick={onAddMember}
                  disabled={isLockedScreen}
                  aria-label={t("add-person")}
                  shortcut="new-person"
                  className="text-primary hover:bg-primary-soft hover:text-primary dark:hover:bg-primary-soft"
                  data-tutorial="add-member"
                >
                  <UserPlus size={20} />
                </ToolbarButton>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t("add-person")} <ShortcutHint shortcut="new-person" />
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToolbarButton
                  onClick={onRemoveMembers}
                  disabled={!selectedNodes.length || isLockedScreen}
                  aria-label={t("remove-person")}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15"
                >
                  <UserMinus />
                </ToolbarButton>
              </TooltipTrigger>
              <TooltipContent side="top">{t("remove-person")}</TooltipContent>
            </Tooltip>
          </ToolbarGroup>
        </>
      )}

      {/* Layout + situational actions, after the canvas-wide ones */}
      <ToolbarSeparator />
      <PanelMoreMenu label={t("more-actions")} side="top">
        {leadingMenuItems}
        {leadingMenuItems && <DropdownMenuSeparator />}
        <DropdownMenuItem
          inset
          onSelect={() => setIsArrangeDialogOpen(true)}
          disabled={isLockedScreen || isLayouting}
        >
          {isLayouting ? <Loader2 className="animate-spin" /> : <Network />}
          {t("arrange-members")}
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={isDiseaseMode}
          onCheckedChange={setIsDiseaseMode}
          onSelect={(e) => e.preventDefault()}
          disabled={isLockedScreen}
        >
          <Activity className={isDiseaseMode ? "fill-current" : ""} />
          {isDiseaseMode ? t("disable-disease-mode") : t("enable-disease-mode")}
        </DropdownMenuCheckboxItem>
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
        {windowed && (
          <>
            <DropdownMenuItem inset onSelect={adjustNeighborhoodDepth(1)}>
              <Plus />
              {t("depth-increase")}
            </DropdownMenuItem>
            <DropdownMenuItem
              inset
              onSelect={adjustNeighborhoodDepth(-1)}
              disabled={neighborhoodUp <= 1 && neighborhoodDown <= 1}
            >
              <Minus />
              {t("depth-decrease")}
            </DropdownMenuItem>
          </>
        )}
        {canFocusHere && (
          <DropdownMenuItem
            inset
            onSelect={() => void setFocusRoot(selectedNodes[0].id)}
          >
            <Crosshair />
            {t("focus-here")}
          </DropdownMenuItem>
        )}
        {!readOnly && canCreateSections && selectedNodes.length === 1 && (
          <DropdownMenuItem inset onSelect={() => setIsCreateSectionOpen(true)}>
            <FolderTree />
            {t("create-section-here")}
          </DropdownMenuItem>
        )}
      </PanelMoreMenu>
      <CreateSectionDialog
        open={isCreateSectionOpen}
        onOpenChange={setIsCreateSectionOpen}
        initialRootMemberId={selectedNodes[0]?.id ?? null}
      />
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
    </>
  );

  async function onAddMember() {
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
