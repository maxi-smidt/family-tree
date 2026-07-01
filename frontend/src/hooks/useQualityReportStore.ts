import { create } from "zustand";
import { QualityReport } from "@/types/quality";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

interface QualityReportState {
  report: QualityReport | null;
  isLoading: boolean;
  showDismissed: boolean;
  refreshReport: (treeId?: string) => Promise<void>;
  setShowDismissed: (show: boolean) => void;
  dismissIssue: (issueId: string) => Promise<void>;
  restoreIssue: (issueId: string) => Promise<void>;
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

  clear: () => set({ report: null, showDismissed: false }),
}));
