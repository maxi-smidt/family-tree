import { create } from "zustand";
import { QualityReport } from "@/types/quality";
import { MergeFieldChoice } from "@/types/merge";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { invalidateDerivedViews } from "@/hooks/invalidateDerivedViews";
import { refreshTaskStore } from "@/hooks/taskStoreRegistry";

interface QualityReportState {
  report: QualityReport | null;
  isLoading: boolean;
  showDismissed: boolean;
  refreshReport: (workspaceId?: string) => Promise<void>;
  setShowDismissed: (show: boolean) => void;
  dismissIssue: (issueId: string) => Promise<void>;
  restoreIssue: (issueId: string) => Promise<void>;
  mergeMembers: (
    keepId: string,
    removeId: string,
    fields: Partial<Record<string, MergeFieldChoice>>,
  ) => Promise<void>;
  clear: () => void;
}

export const useQualityReportStore = create<QualityReportState>((set, get) => ({
  report: null,
  isLoading: false,
  showDismissed: false,

  refreshReport: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) {
      set({ report: null });
      return;
    }
    set({ isLoading: true });
    try {
      const report = await WorkspaceService.getQualityReport(workspaceId);
      if (!isActiveTree(workspaceId)) return; // tree switched/disconnected mid-flight — drop stale data
      set({ report });
    } finally {
      set({ isLoading: false });
    }
  },

  setShowDismissed: (show: boolean) => set({ showDismissed: show }),

  dismissIssue: async (issueId: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;
    await WorkspaceService.dismissQualityIssue(workspaceId, issueId);
    await get().refreshReport(workspaceId);
  },

  restoreIssue: async (issueId: string) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;
    await WorkspaceService.restoreQualityIssue(workspaceId, issueId);
    await get().refreshReport(workspaceId);
  },

  // Merge two members of the tree in place (#729): besides the report and
  // member list, the merge re-points remove's events/stories/gallery tags/
  // documents/tasks onto keep, so any of those stores already loaded in this
  // session would otherwise keep showing pre-merge data until reconnect.
  // invalidateDerivedViews() clears report/statistics/activity first (same
  // as the member-delete path) so the eager refreshes below repopulate them
  // fresh rather than racing a stale clear. Errors (e.g. the 400 cycle
  // guard) propagate to the dialog, which maps them to a specific message.
  mergeMembers: async (keepId, removeId, fields) => {
    const workspaceId = activeTreeId();
    if (!workspaceId) return;
    await WorkspaceService.mergeMembers(workspaceId, {
      keep_id: keepId,
      remove_id: removeId,
      fields,
    });
    invalidateDerivedViews();
    const refreshes: Promise<void>[] = [
      get().refreshReport(workspaceId),
      useMemberStore.getState().refreshMembers(workspaceId),
    ];
    if (useEventStore.getState().initialized) {
      refreshes.push(useEventStore.getState().refreshEvents(workspaceId));
    }
    if (useStoryStore.getState().initialized) {
      refreshes.push(useStoryStore.getState().refreshStories(workspaceId));
    }
    if (useGalleryStore.getState().initialized) {
      refreshes.push(useGalleryStore.getState().refreshGalleryImages(workspaceId));
    }
    if (useDocumentStore.getState().initialized) {
      refreshes.push(useDocumentStore.getState().refreshDocuments(workspaceId));
    }
    // Research tasks are an optional feature loaded through a lazy bridge
    // (taskStoreRegistry) rather than imported directly, same as every other
    // post-mutation task refresh in the app (useGalleryStore, useUploadQueue,
    // realtime.ts) — a no-op until that feature's store has actually loaded.
    refreshTaskStore(workspaceId);
    await Promise.all(refreshes);
  },

  clear: () => set({ report: null, showDismissed: false }),
}));
