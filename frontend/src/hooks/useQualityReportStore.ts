import { create } from "zustand";
import { QualityReport } from "@/types/quality";
import { MergeFieldChoice } from "@/types/merge";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
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
  refreshReport: (treeId?: string) => Promise<void>;
  setShowDismissed: (show: boolean) => void;
  dismissIssue: (issueId: string) => Promise<void>;
  restoreIssue: (issueId: string) => Promise<void>;
  resolveBridgeDrift: (
    memberId: string,
    direction: "push" | "pull",
  ) => Promise<void>;
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

  refreshReport: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ report: null });
      return;
    }
    set({ isLoading: true });
    try {
      const report = await TreeService.getQualityReport(treeId);
      if (!isActiveTree(treeId)) return; // tree switched/disconnected mid-flight — drop stale data
      set({ report });
    } finally {
      set({ isLoading: false });
    }
  },

  setShowDismissed: (show: boolean) => set({ showDismissed: show }),

  dismissIssue: async (issueId: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.dismissQualityIssue(treeId, issueId);
    await get().refreshReport(treeId);
  },

  restoreIssue: async (issueId: string) => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.restoreQualityIssue(treeId, issueId);
    await get().refreshReport(treeId);
  },

  // Resolve bridge-person drift by copying fields across the tree link
  // ("push" = this tree wins, "pull" = the linked tree wins), then reload the
  // report and — on pull — the members, whose fields just changed. Errors
  // (e.g. 403 without write access to the linked tree) propagate to the view.
  resolveBridgeDrift: async (memberId: string, direction: "push" | "pull") => {
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.resolveBridgeDrift(treeId, memberId, direction);
    const tasks: Promise<void>[] = [get().refreshReport(treeId)];
    if (direction === "pull") {
      tasks.push(useMemberStore.getState().refreshMembers(treeId));
    }
    await Promise.all(tasks);
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
    const treeId = activeTreeId();
    if (!treeId) return;
    await TreeService.mergeMembers(treeId, {
      keep_id: keepId,
      remove_id: removeId,
      fields,
    });
    invalidateDerivedViews();
    const refreshes: Promise<void>[] = [
      get().refreshReport(treeId),
      useMemberStore.getState().refreshMembers(treeId),
    ];
    if (useEventStore.getState().initialized) {
      refreshes.push(useEventStore.getState().refreshEvents(treeId));
    }
    if (useStoryStore.getState().initialized) {
      refreshes.push(useStoryStore.getState().refreshStories(treeId));
    }
    if (useGalleryStore.getState().initialized) {
      refreshes.push(useGalleryStore.getState().refreshGalleryImages(treeId));
    }
    if (useDocumentStore.getState().initialized) {
      refreshes.push(useDocumentStore.getState().refreshDocuments(treeId));
    }
    // Research tasks are an optional feature loaded through a lazy bridge
    // (taskStoreRegistry) rather than imported directly, same as every other
    // post-mutation task refresh in the app (useGalleryStore, useUploadQueue,
    // realtime.ts) — a no-op until that feature's store has actually loaded.
    refreshTaskStore(treeId);
    await Promise.all(refreshes);
  },

  clear: () => set({ report: null, showDismissed: false }),
}));
