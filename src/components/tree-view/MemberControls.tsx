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
} from "lucide-react";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { Member } from "@/types/member";
import { NODE_WIDTH } from "@/constants";
import { RelationControls } from "@/components/tree-view/RelationControls";
import { useTranslation } from "react-i18next";

type Props = {
  nodes: Node[];
  selectedNodes: Node[];
  setMembersToDelete: (members: Member[]) => void;
  onEditMember: (member: Member) => void;
  onRearrange: () => void;
};

export const MemberControls = ({
  nodes,
  selectedNodes,
  setMembersToDelete,
  onEditMember,
  onRearrange,
}: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "tree-view.controls" });
  const { isLockedScreen } = useFamilyTreeSettings();
  const { addMember, updateMemberPartial } = useFamilyStore();
  const { screenToFlowPosition } = useReactFlow();

  return (
    <div className="flex flex-col gap-2">
      <RelationControls />
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
      <ButtonGroup orientation="vertical">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="success"
              size="icon"
              onClick={onAddMember}
              disabled={isLockedScreen}
            >
              <UserPlus />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t("add-person")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="destructive"
              size="icon"
              onClick={onRemoveMembers}
              disabled={!selectedNodes.length || isLockedScreen}
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

    const newMember: Member = {
      id: crypto.randomUUID(),
      gender: "o",
      firstName: "New",
      lastName: "Member",
      maidenName: null,
      imageData: null,
      date: { birth: "2026", death: null },
      parents: { paternalParent: null, maternalParent: null },
      additionalData: null,
      isCollapsed: false,
      position: position,
    };

    await addMember(newMember);
    onEditMember(newMember);
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
