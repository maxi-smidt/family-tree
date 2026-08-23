import { create } from "zustand";
import {
  CombinedStatisticsReport,
  CustomWidgetAggregation,
  CustomWidgetAggregationConfig,
  StatisticsReport,
  StatisticsScope,
} from "@/types/statistics";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";

export type { StatisticsScope } from "@/types/statistics";

let customWidgetAggregationRequest = 0;

interface StatisticsState {
  report: StatisticsReport | CombinedStatisticsReport | null;
  isLoading: boolean;
  scope: StatisticsScope;
  customWidgetAggregations: Record<string, CustomWidgetAggregation>;
  isCustomWidgetAggregationsLoading: boolean;
  setScope: (scope: StatisticsScope, workspaceId?: string) => Promise<void>;
  refreshStatistics: (workspaceId?: string) => Promise<void>;
  refreshCustomWidgetAggregations: (
    widgets: CustomWidgetAggregationConfig[],
    workspaceId?: string,
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

  setScope: async (scope, workspaceId = activeTreeId()) => {
    customWidgetAggregationRequest += 1;
    set({ scope, customWidgetAggregations: {} });
    await get().refreshStatistics(workspaceId);
  },

  refreshStatistics: async (workspaceId = activeTreeId()) => {
    if (!workspaceId) {
      set({ report: null });
      return;
    }
    set({ isLoading: true });
    try {
      const report =
        get().scope === "linked"
          ? await WorkspaceService.getCombinedStatistics(workspaceId)
          : await WorkspaceService.getStatistics(workspaceId);
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

    const scope = get().scope;
    const request = ++customWidgetAggregationRequest;
    set({
      customWidgetAggregations: {},
      isCustomWidgetAggregationsLoading: true,
    });
    try {
      const response = await WorkspaceService.getCustomWidgetAggregations(
        workspaceId,
        scope,
        widgets,
      );
      if (
        !isActiveTree(workspaceId) ||
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
        isActiveTree(workspaceId) &&
        get().scope === scope &&
        request === customWidgetAggregationRequest
      ) {
        set({ customWidgetAggregations: {} });
      }
    } finally {
      if (
        isActiveTree(workspaceId) &&
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
