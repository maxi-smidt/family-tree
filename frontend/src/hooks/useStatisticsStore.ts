import { create } from "zustand";
import { CombinedStatisticsReport, StatisticsReport } from "@/types/statistics";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

export type StatisticsScope = "tree" | "linked";

interface StatisticsState {
  report: StatisticsReport | CombinedStatisticsReport | null;
  isLoading: boolean;
  scope: StatisticsScope;
  setScope: (scope: StatisticsScope, treeId?: string) => Promise<void>;
  refreshStatistics: (treeId?: string) => Promise<void>;
  clear: () => void;
}

export const useStatisticsStore = create<StatisticsState>((set, get) => ({
  report: null,
  isLoading: false,
  scope: "tree",

  setScope: async (scope, treeId = activeTreeId()) => {
    set({ scope });
    await get().refreshStatistics(treeId);
  },

  refreshStatistics: async (treeId = activeTreeId()) => {
    if (!treeId) {
      set({ report: null });
      return;
    }
    set({ isLoading: true });
    try {
      const report =
        get().scope === "linked"
          ? await TreeService.getCombinedStatistics(treeId)
          : await TreeService.getStatistics(treeId);
      if (!isActiveTree(treeId)) return;
      set({ report });
    } finally {
      set({ isLoading: false });
    }
  },

  clear: () => set({ report: null, scope: "tree" }),
}));
