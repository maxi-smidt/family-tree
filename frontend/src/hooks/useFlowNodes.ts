import { useMemo } from "react";
import { Node } from "@xyflow/react";
import { Member } from "@/types/member";
import { useTranslation } from "react-i18next";
import { TFunction } from "i18next";
import { getYear } from "@/utils/dateUtils";

const EMPTY_MEMBER_IDS = new Set<string>();

function memberAriaLabel(member: Member, t: TFunction): string {
  const name = `${member.firstName} ${member.lastName}`.trim();
  const gender = t(`common.gender.${member.gender}`);
  const birthYear = getYear(member.date.birth)?.toString() ?? "";
  const deathYear = getYear(member.date.death)?.toString() ?? "";
  const dates = birthYear
    ? deathYear
      ? `${birthYear}–${deathYear}`
      : birthYear
    : "";
  return t("tree-view.node.aria-node-label", { name, gender, dates });
}

export const useFlowNodes = (
  nodes: Node[],
  setEditingMemberId: (id: string) => void,
  setIsEditMode: (isEdit: boolean) => void,
  onAddChild: (parentId: string) => void,
  onAddParent: (childId: string) => void,
  onAddLeft: (memberId: string) => void,
  onAddRight: (memberId: string) => void,
  highlightedNodeId: string | null,
  isReadOnly = false,
  connectionSelectedIds: ReadonlySet<string> = EMPTY_MEMBER_IDS,
  connectionPathNodeIds: ReadonlySet<string> = EMPTY_MEMBER_IDS,
  isConnectionMode = false,
  hasConnectionPath = false,
  hiddenNodeIds: ReadonlySet<string> = EMPTY_MEMBER_IDS,
  onOpenLinkedTree?: (workspaceId: string, memberId?: string | null) => void,
  purelyVisual = false,
  // Workspace ids the current user has listed access to (own + shared). undefined
  // = unknown (e.g. public view without a tree list) — badges then render
  // normally instead of guessing.
  accessibleTreeIds?: ReadonlySet<string>,
  isSelectionMode = false,
) => {
  const { t } = useTranslation();

  return useMemo(() => {
    return nodes.map((node) => {
      const isMemberNode = !node.id.startsWith("union-");
      const memberA11yProps = isMemberNode
        ? {
            ariaLabel: memberAriaLabel(node.data as Member, t),
            ariaRole: "button" as const,
          }
        : {};

      const linkedWorkspaceId = (node.data as Member).linkedWorkspaceId ?? null;
      const linkedMemberId = (node.data as Member).linkedMemberId ?? null;

      return {
        ...node,
        ...memberA11yProps,
        // Union nodes have no member data — skip the visibility check.
        hidden: isMemberNode ? hiddenNodeIds.has(node.id) : false,
        data: {
          ...node.data,
          isHighlighted: node.id === highlightedNodeId,
          // The tree-in-tree badge is interactive even for viewers (navigation
          // is a read action).
          onOpenLinkedTree:
            linkedWorkspaceId && onOpenLinkedTree
              ? () => onOpenLinkedTree(linkedWorkspaceId, linkedMemberId)
              : undefined,
          // False only when we positively know the tree isn't in the user's
          // list; the badge then renders muted and disabled with a "not
          // shared with you" hint — navigating would open a tree that appears
          // nowhere else in their UI.
          linkedTreeAccessible:
            !linkedWorkspaceId || !accessibleTreeIds
              ? true
              : accessibleTreeIds.has(linkedWorkspaceId),
          isConnectionSelected: connectionSelectedIds.has(node.id),
          isConnectionPath: connectionPathNodeIds.has(node.id),
          isConnectionDimmed:
            isConnectionMode &&
            hasConnectionPath &&
            !connectionPathNodeIds.has(node.id),
          isReadOnly,
          isSelectionMode,
          // Public view: block the name-link detail dialog too (onView/onEdit
          // are already nulled out above via purelyVisual/isReadOnly).
          disableNameLink: purelyVisual,
          onEdit: isReadOnly
            ? undefined
            : () => {
                setEditingMemberId(node.id);
                setIsEditMode(true);
              },
          // Purely-visual nodes (public view) expose no detail sheet.
          onView: purelyVisual
            ? undefined
            : () => {
                setEditingMemberId(node.id);
                setIsEditMode(false);
              },
          onAddChild: isReadOnly
            ? undefined
            : () => {
                onAddChild(node.id);
              },
          onAddParent: isReadOnly
            ? undefined
            : () => {
                onAddParent(node.id);
              },
          onAddLeft: isReadOnly
            ? undefined
            : () => {
                onAddLeft(node.id);
              },
          onAddRight: isReadOnly
            ? undefined
            : () => {
                onAddRight(node.id);
              },
        },
      };
    });
  }, [
    nodes,
    setEditingMemberId,
    setIsEditMode,
    onAddChild,
    onAddParent,
    onAddLeft,
    onAddRight,
    highlightedNodeId,
    isReadOnly,
    connectionSelectedIds,
    connectionPathNodeIds,
    isConnectionMode,
    hasConnectionPath,
    hiddenNodeIds,
    onOpenLinkedTree,
    purelyVisual,
    accessibleTreeIds,
    isSelectionMode,
    t,
  ]);
};
