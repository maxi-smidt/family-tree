import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlowInstance } from "@xyflow/react";
import { Member } from "@/types/member";
import { NODE_WIDTH } from "@/constants";
import { useMemberStore } from "@/hooks/useMemberStore";
import { collectCollapsedAncestorIds } from "@/utils/locateMemberUtils";

export const useMemberLocator = (
  members: Member[],
  rfInstance: ReactFlowInstance | null,
) => {
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(
    null,
  );
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { updateMemberPartial } = useMemberStore();

  // Clean up the highlight timeout on unmount.
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const locateMember = useCallback(
    (member: Member) => {
      // Un-collapse any collapsed ancestors so the node becomes visible.
      const collapsedIds = collectCollapsedAncestorIds(members, member.id);
      for (const id of collapsedIds) {
        void updateMemberPartial(id, { isCollapsed: false });
      }

      const node = rfInstance?.getNode(member.id);
      const width = node?.measured?.width ?? NODE_WIDTH;
      const height = node?.measured?.height ?? 0;
      const centerX = (node?.position.x ?? member.position.x) + width / 2;
      const centerY = (node?.position.y ?? member.position.y) + height / 2;

      rfInstance?.setCenter(centerX, centerY, {
        zoom: Math.max(rfInstance.getZoom(), 1.2),
        duration: 800,
      });

      setHighlightedNodeId(member.id);
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      highlightTimeoutRef.current = setTimeout(
        () => setHighlightedNodeId(null),
        2500,
      );
    },
    [members, rfInstance, updateMemberPartial],
  );

  return { highlightedNodeId, locateMember };
};
