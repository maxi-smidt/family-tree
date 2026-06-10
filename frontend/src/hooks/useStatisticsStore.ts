import { create } from "zustand";
import { StatisticsReport } from "@/types/statistics";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

interface StatisticsState {
  report: StatisticsReport | null;
  isLoading: boolean;
  refreshStatistics: (treeId?: string) => Promise<void>;
  clear: () => void;
}

export const useStatisticsStore = create<StatisticsState>((set) => ({
  report: null,
  isLoading: false,

  refreshStatistics: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ report: null });
      return;
    }
    set({ isLoading: true });
    try {
      const report = await TreeService.getStatistics(treeId);
      if (!isActiveTree(treeId)) return;
      set({ report });
    } finally {
      set({ isLoading: false });
    }
  },

  clear: () => set({ report: null }),
}));
