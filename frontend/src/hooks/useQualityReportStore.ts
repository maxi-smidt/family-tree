import { create } from "zustand";
import { QualityReport } from "@/types/quality";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
import { useMemberStore } from "@/hooks/useMemberStore";

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

  clear: () => set({ report: null, showDismissed: false }),
}));
