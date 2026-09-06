import { create } from "zustand";
import {
  CustomWidgetAggregation,
  CustomWidgetAggregationConfig,
  StatisticsReport,
} from "@/types/statistics";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";

let customWidgetAggregationRequest = 0;

interface StatisticsState {
  report: StatisticsReport | null;
  isLoading: boolean;
  customWidgetAggregations: Record<string, CustomWidgetAggregation>;
  isCustomWidgetAggregationsLoading: boolean;
  refreshStatistics: (workspaceId?: string) => Promise<void>;
  refreshCustomWidgetAggregations: (
    widgets: CustomWidgetAggregationConfig[],
    workspaceId?: string,
  ) => Promise<void>;
  clearCustomWidgetAggregations: () => void;
  clear: () => void;
}

export const useStatisticsStore = create<StatisticsState>((set) => ({
  report: null,
  isLoading: false,
  customWidgetAggregations: {},
  isCustomWidgetAggregationsLoading: false,

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

  refreshCustomWidgetAggregations: async (widgets, workspaceId = activeTreeId()) => {
    if (!workspaceId || widgets.length === 0) {
      customWidgetAggregationRequest += 1;
      set({
        customWidgetAggregations: {},
        isCustomWidgetAggregationsLoading: false,
      });
      return;
    }

    const request = ++customWidgetAggregationRequest;
    set({
      customWidgetAggregations: {},
      isCustomWidgetAggregationsLoading: true,
    });
    try {
      const response = await WorkspaceService.getCustomWidgetAggregations(
        workspaceId,
        widgets,
      );
      if (!isActiveTree(workspaceId) || request !== customWidgetAggregationRequest) {
        return;
      }
      set({
        customWidgetAggregations: Object.fromEntries(
          response.widgets.map((widget) => [widget.id, widget]),
        ),
      });
    } catch {
      if (isActiveTree(workspaceId) && request === customWidgetAggregationRequest) {
        set({ customWidgetAggregations: {} });
      }
    } finally {
      if (isActiveTree(workspaceId) && request === customWidgetAggregationRequest) {
        set({ isCustomWidgetAggregationsLoading: false });
      }
    }
  },

  clearCustomWidgetAggregations: () => {
    customWidgetAggregationRequest += 1;
    set({
      customWidgetAggregations: {},
      isCustomWidgetAggregationsLoading: false,
    });
  },

  clear: () => {
    customWidgetAggregationRequest += 1;
    set({
      report: null,
      customWidgetAggregations: {},
      isCustomWidgetAggregationsLoading: false,
    });
  },
}));
