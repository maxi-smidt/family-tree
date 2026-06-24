import { Node, useReactFlow } from "@xyflow/react";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ListChevronsUpDown,
  Network,
  UserMinus,
  UserPlus,
  UserRoundPlus,
  Activity,
  Crosshair,
  Minus,
  Plus,
} from "lucide-react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
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
  const {
    isLockedScreen,
    isFastMode,
    setIsFastMode,
    isDiseaseMode,
    setIsDiseaseMode,
  } = useFamilyTreeSettings();
  const {
    batchSetCollapsed,
    windowed,
    neighborhoodUp,
    neighborhoodDown,
    setFocusRoot,
    setNeighborhoodDepth,
  } = useMemberStore();
  const { screenToFlowPosition } = useReactFlow();

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

      {/* Layout */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            onClick={onRearrange}
            disabled={isLockedScreen}
            aria-label={t("arrange-members")}
          >
            <Network />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{t("arrange-members")}</TooltipContent>
      </Tooltip>

      {windowed && (
        <>
          <Separator className="my-1" />
          {/* Neighborhood depth controls */}
          <ButtonGroup orientation="vertical">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() =>
                    void setNeighborhoodDepth(
                      Math.min(neighborhoodUp + 1, 10),
                      Math.min(neighborhoodDown + 1, 10),
                    )
                  }
                  aria-label={t("depth-increase")}
                >
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{t("depth-increase")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() =>
                    void setNeighborhoodDepth(
                      Math.max(neighborhoodUp - 1, 1),
                      Math.max(neighborhoodDown - 1, 1),
                    )
                  }
                  disabled={neighborhoodUp <= 1 && neighborhoodDown <= 1}
                  aria-label={t("depth-decrease")}
                >
                  <Minus />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{t("depth-decrease")}</TooltipContent>
            </Tooltip>
          </ButtonGroup>
          {selectedNodes.length === 1 && (
            <>
              <Separator className="my-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => void setFocusRoot(selectedNodes[0].id)}
                    aria-label={t("focus-here")}
                  >
                    <Crosshair />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">{t("focus-here")}</TooltipContent>
              </Tooltip>
            </>
          )}
        </>
      )}

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
