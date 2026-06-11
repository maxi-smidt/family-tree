import { create } from "zustand";
import { QualityReport } from "@/types/quality";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

interface QualityReportState {
  report: QualityReport | null;
  isLoading: boolean;
  refreshReport: (treeId?: string) => Promise<void>;
  clear: () => void;
}

export const useQualityReportStore = create<QualityReportState>((set) => ({
  report: null,
  isLoading: false,

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

  clear: () => set({ report: null }),
}));
