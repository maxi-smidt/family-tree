import { create } from "zustand";
import { Activity, ActivityUndoDB, mapActivityFromDB } from "@/types/activity";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";

export const ACTIVITY_PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

type FilterKey = "filterActor" | "filterAction" | "filterTargetType";

interface ActivityState {
  activities: Activity[];
  actors: string[];
  total: number;
  page: number;
  pageSize: number;
  filterActor: string;
  filterAction: string;
  filterTargetType: string;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  load: (workspaceId: string, page: number) => Promise<void>;
  refreshActivity: (workspaceId?: string) => Promise<void>;
  setPage: (page: number, workspaceId?: string) => Promise<void>;
  setPageSize: (size: number, workspaceId?: string) => Promise<void>;
  setFilter: (key: FilterKey, val: string, workspaceId?: string) => Promise<void>;
  clearFilters: (workspaceId?: string) => Promise<void>;
  retry: (workspaceId?: string) => Promise<void>;
  undo: (entryId: string, workspaceId?: string) => Promise<ActivityUndoDB>;
  clear: () => void;
}

const initialState = {
  activities: [] as Activity[],
  actors: [] as string[],
  total: 0,
  page: 0,
  pageSize: DEFAULT_PAGE_SIZE,
  filterActor: "",
  filterAction: "",
  filterTargetType: "",
  initialized: false,
  loading: false,
  error: null as string | null,
};

export const useActivityStore = create<ActivityState>((set, get) => {
  // Monotonic request counter guarding against out-of-order responses. When the
  // user changes page, page size, or a filter faster than the server responds,
  // several loads for the same tree are in flight at once; only the most recent
  // one may write results, loading, or error into the store. Kept in the store
  // closure (not in state) so bumping it never triggers a re-render.
  let requestId = 0;

  return {
    ...initialState,

    load: async (workspaceId: string, page: number) => {
      const { pageSize, filterActor, filterAction, filterTargetType } = get();
      const reqId = ++requestId;
      set({ loading: true, error: null });
      try {
        const result = await WorkspaceService.getActivity(workspaceId, {
          offset: page * pageSize,
          limit: pageSize,
          actor: filterActor || undefined,
          action: filterAction || undefined,
          target_type: filterTargetType || undefined,
        });
        // Drop the response if a newer request superseded it, or the tree
        // switched mid-flight — stale data must never overwrite newer state.
        if (reqId !== requestId || !isActiveTree(workspaceId)) return;
        set({
          activities: result.entries.map(mapActivityFromDB),
          actors: result.actors,
          total: result.total,
          page,
          initialized: true,
          loading: false,
        });
      } catch (error) {
        if (reqId !== requestId || !isActiveTree(workspaceId)) return;
        set({ loading: false, error: String(error) });
      }
    },

    refreshActivity: async (workspaceId = activeTreeId()) => {
      if (!workspaceId) {
        set({ activities: [], actors: [], total: 0, initialized: false });
        return;
      }
      await get().load(workspaceId, get().page);
    },

    setPage: async (page, workspaceId = activeTreeId()) => {
      if (!workspaceId) return;
      await get().load(workspaceId, page);
    },

    setPageSize: async (size, workspaceId = activeTreeId()) => {
      set({ pageSize: size });
      if (!workspaceId) return;
      await get().load(workspaceId, 0);
    },

    setFilter: async (key, val, workspaceId = activeTreeId()) => {
      set({ [key]: val });
      if (!workspaceId) return;
      await get().load(workspaceId, 0);
    },

    clearFilters: async (workspaceId = activeTreeId()) => {
      set({ filterActor: "", filterAction: "", filterTargetType: "" });
      if (!workspaceId) return;
      await get().load(workspaceId, 0);
    },

    retry: async (workspaceId = activeTreeId()) => {
      if (!workspaceId) return;
      await get().load(workspaceId, get().page);
    },

    undo: async (entryId, workspaceId = activeTreeId()) => {
      if (!workspaceId) throw new Error("No active tree");
      const report = await WorkspaceService.undoActivity(workspaceId, entryId);
      // Content stores refresh themselves via the workspace.content_changed SSE
      // event the backend publishes; only the activity list itself needs an
      // explicit reload here.
      await get().refreshActivity(workspaceId);
      return report;
    },

    // Invalidate any in-flight request so its late response can't repopulate a
    // store that has since been reset (e.g. tree switch or logout).
    clear: () => {
      requestId++;
      set({ ...initialState });
    },
  };
});
