import { useEffect } from "react";
import { isVirtualId, useTreeStore } from "@/hooks/useTreeStore";
import { useFeature } from "@/hooks/useAuthStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import {
  setEditingMember,
  startPresence,
  stopPresence,
} from "@/services/presence";

/**
 * Drives presence heartbeats from React state. Mounted once where a tree is
 * open; starts/stops the heartbeat loop as the active tree changes and reports
 * which member (if any) this client is editing.
 *
 * Presence is gated behind the `presence` feature flag and never runs for
 * virtual views (read-only composites with no presence endpoint).
 */
export function usePresence(): void {
  const enabled = useFeature("presence");
  const treeId = useTreeStore((s) => s.selectedTree?.id);
  const activeTreeId =
    enabled && treeId && !isVirtualId(treeId) ? treeId : null;

  useEffect(() => {
    if (!activeTreeId) return;
    startPresence(activeTreeId);
    return () => stopPresence();
  }, [activeTreeId]);

  // The member this client currently has open in edit mode, if any.
  const editingMemberId = useMemberSheetStore((s) => {
    if (!activeTreeId) return null;
    const sheet = s.openSheets[activeTreeId];
    return sheet && sheet.mode === "edit" ? sheet.memberId : null;
  });

  useEffect(() => {
    if (!activeTreeId) return;
    setEditingMember(editingMemberId);
  }, [activeTreeId, editingMemberId]);
}
