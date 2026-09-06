import { create } from "zustand";
import {
  SavedViewCreateInput,
  SavedViewDB,
  SavedViewUpdateInput,
} from "@/types/savedView";
import { WorkspaceService } from "@/services/WorkspaceService";
import { activeTreeId, isActiveTree } from "@/hooks/useWorkspaceStore";

interface SavedViewState {
  views: SavedViewDB[];
  initialized: boolean;
  loading: boolean;
  refreshSavedViews: (workspaceId?: string) => Promise<void>;
  createSavedView: (payload: SavedViewCreateInput) => Promise<SavedViewDB>;
  updateSavedView: (
    viewId: string,
    payload: SavedViewUpdateInput,
  ) => Promise<SavedViewDB>;
  deleteSavedView: (viewId: string) => Promise<void>;
  /** Creates a new view from an existing one's configuration — the "save as"
   *  duplicate action never touches the source view. */
  duplicateSavedView: (view: SavedViewDB, name: string) => Promise<SavedViewDB>;
  clear: () => void;
}

export const useSavedViewStore = create<SavedViewState>((set, get) => {
  // Guards against a slower, superseded refresh overwriting a newer one —
  // same pattern as useSectionStore.
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

    // The three mutations below patch `views` from the mutation's own
    // response rather than re-fetching the whole list: a re-fetch that
    // failed after a successful mutation would otherwise leave the list
    // silently out of sync with the server (and the caller none the wiser).
    createSavedView: async (payload) => {
      const workspaceId = activeTreeId();
      if (!workspaceId) throw new Error("No active tree");
      const view = await WorkspaceService.createSavedView(workspaceId, payload);
      if (isActiveTree(workspaceId)) {
        set((state) => ({ views: [...state.views, view], initialized: true }));
      }
      return view;
    },

    updateSavedView: async (viewId, payload) => {
      const workspaceId = activeTreeId();
      if (!workspaceId) throw new Error("No active tree");
      const view = await WorkspaceService.updateSavedView(
        workspaceId,
        viewId,
        payload,
      );
      if (isActiveTree(workspaceId)) {
        set((state) => ({
          views: state.views.map((v) => (v.id === view.id ? view : v)),
        }));
      }
      return view;
    },

    deleteSavedView: async (viewId) => {
      const workspaceId = activeTreeId();
      if (!workspaceId) return;
      await WorkspaceService.deleteSavedView(workspaceId, viewId);
      if (isActiveTree(workspaceId)) {
        set((state) => ({
          views: state.views.filter((v) => v.id !== viewId),
        }));
      }
    },

    duplicateSavedView: (view, name) =>
      get().createSavedView({
        name,
        focus_member_id: view.focus_member_id,
        section_ids: view.section_ids,
        ancestor_depth: view.ancestor_depth,
        descendant_depth: view.descendant_depth,
        include_partners: view.include_partners,
        filters: view.filters,
      }),

    clear: () => {
      requestId++;
      set({ views: [], initialized: false, loading: false });
    },
  };
});
