import { useMemo } from "react";
import { Node } from "@xyflow/react";
import { Member } from "@/types/member";

export const useFlowNodes = (
  nodes: Node[],
  setEditingMemberId: (id: string) => void,
  setIsEditMode: (isEdit: boolean) => void,
) => {
  return useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const visibilityCache = new Map<string, boolean>();

    const isNodeVisible = (nodeId: string): boolean => {
      if (visibilityCache.has(nodeId)) return visibilityCache.get(nodeId)!;

      const node = nodeMap.get(nodeId);
      if (!node) return false;
      const member = node.data as Member;
      const parentIds = [
        member.parents.maternalParent,
        member.parents.paternalParent,
      ].filter(Boolean);

      if (parentIds.length === 0) {
        visibilityCache.set(nodeId, true);
        return true;
      }

      const isVisible = parentIds.every((parentId) => {
        const parent = nodeMap.get(parentId as string);
        if (!parent) return true;
        return !parent.data.isCollapsed && isNodeVisible(parentId as string);
      });

      visibilityCache.set(nodeId, isVisible);
      return isVisible;
    };

    return nodes.map((node) => ({
      ...node,
      hidden: !isNodeVisible(node.id),
      data: {
        ...node.data,
        onEdit: () => {
          setEditingMemberId(node.id);
          setIsEditMode(true);
        },
        onView: () => {
          setEditingMemberId(node.id);
          setIsEditMode(false);
        },
      },
    }));
  }, [nodes, setEditingMemberId, setIsEditMode]);
};
