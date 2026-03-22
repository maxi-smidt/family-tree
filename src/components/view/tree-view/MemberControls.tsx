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
  Zap,
  Activity,
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
};

export const MemberControls = ({
  nodes,
  selectedNodes,
  setMembersToDelete,
  onCreateNewMember,
  onRearrange,
}: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-view.controls" });
  const {
    isLockedScreen,
    isFastMode,
    setIsFastMode,
    isDiseaseMode,
    setIsDiseaseMode,
  } = useFamilyTreeSettings();
  const { updateMemberPartial } = useMemberStore();
  const { screenToFlowPosition } = useReactFlow();

  return (
    <div className="flex flex-col gap-2">
      {/* Relations */}
      <RelationControls />

      <Separator className="my-1" />

      {/* View Modes */}
      <ButtonGroup orientation="vertical">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isFastMode ? "default" : "secondary"}
              size="icon"
              onClick={() => setIsFastMode(!isFastMode)}
              disabled={isLockedScreen}
            >
              <Zap className={isFastMode ? "fill-current" : ""} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {isFastMode ? t("disable-fast-mode") : t("enable-fast-mode")}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isDiseaseMode ? "default" : "secondary"}
              size="icon"
              onClick={() => setIsDiseaseMode(!isDiseaseMode)}
              disabled={isLockedScreen}
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
          >
            <Network />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{t("arrange-members")}</TooltipContent>
      </Tooltip>

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
            >
              <ListChevronsUpDown />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {t("expand-all-children")}
          </TooltipContent>
        </Tooltip>
      </ButtonGroup>

      <Separator className="my-1" />

      {/* Member Add/Remove */}
      <ButtonGroup orientation="vertical">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              onClick={onAddMember}
              disabled={isLockedScreen}
              className="text-green-600 hover:bg-green-50 hover:text-green-700"
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
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <UserMinus />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t("remove-person")}</TooltipContent>
        </Tooltip>
      </ButtonGroup>
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
    selectedNodes.forEach((node) =>
      updateMemberPartial(node.id, { isCollapsed: false }),
    );
  }

  function onExpandAllMembers() {
    nodes.forEach((node) =>
      updateMemberPartial(node.id, { isCollapsed: false }),
    );
  }

  function onCollapseMembers() {
    selectedNodes.forEach((node) =>
      updateMemberPartial(node.id, { isCollapsed: true }),
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
