import { useMemo } from "react";
import { Node } from "@xyflow/react";
import { Member } from "@/types/member";

export const useFlowNodes = (
  nodes: Node[],
  setEditingMemberId: (id: string) => void,
  setIsEditMode: (isEdit: boolean) => void,
  onAddChild: (parentId: string) => void,
  onAddParent: (childId: string) => void,
) => {
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
        onAddChild: () => {
          onAddChild(node.id);
        },
        onAddParent: () => {
          onAddParent(node.id);
        },
      },
    }));
  }, [nodes, setEditingMemberId, setIsEditMode, onAddChild, onAddParent]);
};
