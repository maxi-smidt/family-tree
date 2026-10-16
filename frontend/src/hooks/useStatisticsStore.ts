import { create } from "zustand";
import { StatisticsReport } from "@/types/statistics";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";

interface StatisticsState {
  report: StatisticsReport | null;
  isLoading: boolean;
  refreshStatistics: (workspaceId?: string) => Promise<void>;
  clear: () => void;
}

export const useStatisticsStore = create<StatisticsState>((set) => ({
  report: null,
  isLoading: false,

  refreshStatistics: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) {
      set({ report: null });
      return;
    }
    set({ isLoading: true });
    try {
      const report = await WorkspaceService.getStatistics(workspaceId);
      if (!isActiveTree(workspaceId)) return;
      set({ report });
    } finally {
      set({ isLoading: false });
    }
  },

  clear: () => {
    set({
      report: null,
    });
  },
}));
