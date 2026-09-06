import { useEffect } from "react";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
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
 */
export function usePresence(): void {
  const workspaceId = useWorkspaceStore((s) => s.selectedTree?.id);
  const activeTreeId = workspaceId ?? null;

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
