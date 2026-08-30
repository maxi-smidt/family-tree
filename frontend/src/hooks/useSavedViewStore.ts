import { create } from "zustand";
import { SavedViewDB } from "@/types/savedView";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";

/** Listing only — creation/configuration/editing is #1013. */
interface SavedViewState {
  views: SavedViewDB[];
  initialized: boolean;
  loading: boolean;
  refreshSavedViews: (workspaceId?: string) => Promise<void>;
  clear: () => void;
}

export const useSavedViewStore = create<SavedViewState>((set) => {
  let requestId = 0;

  return {
    views: [],
    initialized: false,
    loading: false,

    refreshSavedViews: async (workspaceId = activeTreeId()) => {
      if (!workspaceId) {
        set({ views: [], initialized: false });
        return;
      }
      const reqId = ++requestId;
      set({ loading: true });
      try {
        const views = await WorkspaceService.getSavedViews(workspaceId);
        if (reqId !== requestId || !isActiveTree(workspaceId)) return;
        set({ views, initialized: true, loading: false });
      } catch {
        if (reqId !== requestId || !isActiveTree(workspaceId)) return;
        set({ loading: false });
      }
    },

    clear: () => {
      requestId++;
      set({ views: [], initialized: false, loading: false });
    },
  };
});
