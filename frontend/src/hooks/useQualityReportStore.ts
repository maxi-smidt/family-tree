import { create } from "zustand";
import { QualityReport } from "@/types/quality";
import { TreeService } from "@/services/TreeService";
import { activeTreeId } from "@/hooks/useTreeStore";

interface QualityReportState {
  report: QualityReport | null;
  isLoading: boolean;
  refreshReport: () => Promise<void>;
}

export const useQualityReportStore = create<QualityReportState>((set) => ({
  report: null,
  isLoading: false,

  refreshReport: async () => {
    const treeId = activeTreeId();
    if (!treeId) {
      set({ report: null });
      return;
    }
    set({ isLoading: true });
    try {
      const report = await TreeService.getQualityReport(treeId);
      set({ report });
    } finally {
      set({ isLoading: false });
    }
  },
}));
