import { useMemo } from "react";
import { Node } from "@xyflow/react";
import { Member } from "@/types/member";
import { useTranslation } from "react-i18next";
import { TFunction } from "i18next";

const EMPTY_MEMBER_IDS = new Set<string>();

function memberAriaLabel(
  member: Member,
  t: TFunction,
): string {
  const name = `${member.firstName} ${member.lastName}`.trim();
  const gender = t(`common.gender.${member.gender}`);
  const birthYear = member.date.birth
    ? new Date(member.date.birth).getFullYear().toString()
    : "";
  const deathYear = member.date.death
    ? new Date(member.date.death).getFullYear().toString()
    : "";
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
) => {
  const { t } = useTranslation();

  return useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const visibilityCache = new Map<string, boolean>();
    const visiting = new Set<string>();

    const isNodeVisible = (nodeId: string): boolean => {
      if (visibilityCache.has(nodeId)) return visibilityCache.get(nodeId)!;
      if (visiting.has(nodeId)) {
        // Cycle detected, assume visible to prevent crash and allow user to fix
        return true;
      }

      visiting.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (!node) {
        visiting.delete(nodeId);
        return false;
      }

      const member = node.data as Member;
      const parentIds = [
        member.parents.maternalParent,
        member.parents.paternalParent,
      ].filter(Boolean);

      if (parentIds.length === 0) {
        visibilityCache.set(nodeId, true);
        visiting.delete(nodeId);
        return true;
      }

      const isVisible = parentIds.every((parentId) => {
        const parent = nodeMap.get(parentId as string);
        if (!parent) return true;
        return !parent.data.isCollapsed && isNodeVisible(parentId as string);
      });

      visibilityCache.set(nodeId, isVisible);
      visiting.delete(nodeId);
      return isVisible;
    };

    return nodes.map((node) => {
      const isMemberNode = !node.id.startsWith("union-");
      const memberA11yProps = isMemberNode
        ? {
            ariaLabel: memberAriaLabel(node.data as Member, t),
            ariaRole: "button" as const,
          }
        : {};

      return {
        ...node,
        ...memberA11yProps,
        // Union nodes have no member data — skip the visibility walk.
        hidden: isMemberNode ? !isNodeVisible(node.id) : false,
        data: {
          ...node.data,
          isHighlighted: node.id === highlightedNodeId,
          isConnectionSelected: connectionSelectedIds.has(node.id),
          isConnectionPath: connectionPathNodeIds.has(node.id),
          isConnectionDimmed:
            isConnectionMode &&
            hasConnectionPath &&
            !connectionPathNodeIds.has(node.id),
          isReadOnly,
          onEdit: isReadOnly
            ? undefined
            : () => {
                setEditingMemberId(node.id);
                setIsEditMode(true);
              },
          onView: () => {
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
    t,
  ]);
};
