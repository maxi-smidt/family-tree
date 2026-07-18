import { create } from "zustand";
import {
  CombinedStatisticsReport,
  CustomWidgetAggregation,
  CustomWidgetAggregationConfig,
  StatisticsReport,
  StatisticsScope,
} from "@/types/statistics";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

export type { StatisticsScope } from "@/types/statistics";

let customWidgetAggregationRequest = 0;

interface StatisticsState {
  report: StatisticsReport | CombinedStatisticsReport | null;
  isLoading: boolean;
  scope: StatisticsScope;
  customWidgetAggregations: Record<string, CustomWidgetAggregation>;
  isCustomWidgetAggregationsLoading: boolean;
  setScope: (scope: StatisticsScope, treeId?: string) => Promise<void>;
  refreshStatistics: (treeId?: string) => Promise<void>;
  refreshCustomWidgetAggregations: (
    widgets: CustomWidgetAggregationConfig[],
    treeId?: string,
  ) => Promise<void>;
  clearCustomWidgetAggregations: () => void;
  clear: () => void;
}

export const useStatisticsStore = create<StatisticsState>((set, get) => ({
  report: null,
  isLoading: false,
  scope: "tree",
  customWidgetAggregations: {},
  isCustomWidgetAggregationsLoading: false,

  setScope: async (scope, treeId = activeTreeId()) => {
    customWidgetAggregationRequest += 1;
    set({ scope, customWidgetAggregations: {} });
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

  refreshCustomWidgetAggregations: async (widgets, treeId = activeTreeId()) => {
    if (!treeId || widgets.length === 0) {
      customWidgetAggregationRequest += 1;
      set({
        customWidgetAggregations: {},
        isCustomWidgetAggregationsLoading: false,
      });
      return;
    }

    const scope = get().scope;
    const request = ++customWidgetAggregationRequest;
    set({
      customWidgetAggregations: {},
      isCustomWidgetAggregationsLoading: true,
    });
    try {
      const response = await TreeService.getCustomWidgetAggregations(
        treeId,
        scope,
        widgets,
      );
      if (
        !isActiveTree(treeId) ||
        get().scope !== scope ||
        request !== customWidgetAggregationRequest
      ) {
        return;
      }
      set({
        customWidgetAggregations: Object.fromEntries(
          response.widgets.map((widget) => [widget.id, widget]),
        ),
      });
    } catch {
      // Never fall back to the active-tree members for linked scope: showing
      // a blank widget is safer than silently presenting the wrong scope.
      if (
        isActiveTree(treeId) &&
        get().scope === scope &&
        request === customWidgetAggregationRequest
      ) {
        set({ customWidgetAggregations: {} });
      }
    } finally {
      if (
        isActiveTree(treeId) &&
        get().scope === scope &&
        request === customWidgetAggregationRequest
      ) {
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
      scope: "tree",
      customWidgetAggregations: {},
      isCustomWidgetAggregationsLoading: false,
    });
  },
}));
