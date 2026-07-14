import { create } from "zustand";
import { Activity, mapActivityFromDB } from "@/types/activity";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";

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
  load: (treeId: string, page: number) => Promise<void>;
  refreshActivity: (treeId?: string) => Promise<void>;
  setPage: (page: number, treeId?: string) => Promise<void>;
  setPageSize: (size: number, treeId?: string) => Promise<void>;
  setFilter: (key: FilterKey, val: string, treeId?: string) => Promise<void>;
  clearFilters: (treeId?: string) => Promise<void>;
  retry: (treeId?: string) => Promise<void>;
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

    load: async (treeId: string, page: number) => {
      const { pageSize, filterActor, filterAction, filterTargetType } = get();
      const reqId = ++requestId;
      set({ loading: true, error: null });
      try {
        const result = await TreeService.getActivity(treeId, {
          offset: page * pageSize,
          limit: pageSize,
          actor: filterActor || undefined,
          action: filterAction || undefined,
          target_type: filterTargetType || undefined,
        });
        // Drop the response if a newer request superseded it, or the tree
        // switched mid-flight — stale data must never overwrite newer state.
        if (reqId !== requestId || !isActiveTree(treeId)) return;
        set({
          activities: result.entries.map(mapActivityFromDB),
          actors: result.actors,
          total: result.total,
          page,
          initialized: true,
          loading: false,
        });
      } catch (error) {
        if (reqId !== requestId || !isActiveTree(treeId)) return;
        set({ loading: false, error: String(error) });
      }
    },

    refreshActivity: async (treeId = activeTreeId()) => {
      if (!treeId) {
        set({ activities: [], actors: [], total: 0, initialized: false });
        return;
      }
      await get().load(treeId, get().page);
    },

    setPage: async (page, treeId = activeTreeId()) => {
      if (!treeId) return;
      await get().load(treeId, page);
    },

    setPageSize: async (size, treeId = activeTreeId()) => {
      set({ pageSize: size });
      if (!treeId) return;
      await get().load(treeId, 0);
    },

    setFilter: async (key, val, treeId = activeTreeId()) => {
      set({ [key]: val });
      if (!treeId) return;
      await get().load(treeId, 0);
    },

    clearFilters: async (treeId = activeTreeId()) => {
      set({ filterActor: "", filterAction: "", filterTargetType: "" });
      if (!treeId) return;
      await get().load(treeId, 0);
    },

    retry: async (treeId = activeTreeId()) => {
      if (!treeId) return;
      await get().load(treeId, get().page);
    },

    // Invalidate any in-flight request so its late response can't repopulate a
    // store that has since been reset (e.g. tree switch or logout).
    clear: () => {
      requestId++;
      set({ ...initialState });
    },
  };
});
