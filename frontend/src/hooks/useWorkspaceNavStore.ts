import { create } from "zustand";

/**
 * Selection state for the workspace navigation tree (#988): Explore /
 * Sections / Saved views. This is UI selection only — the corresponding
 * graph focus/scope change on `useMemberStore` (#989) is driven separately by
 * the caller (see `WorkspaceNavigationPanel`). Reset whenever the active
 * workspace changes so a selection never survives a tree switch and points
 * at the wrong workspace.
 */
export type WorkspaceNavMode = "explore" | "section" | "saved-view";

interface WorkspaceNavState {
  mode: WorkspaceNavMode;
  selectedSectionId: string | null;
  selectedSavedViewId: string | null;
  selectExplore: () => void;
  selectSection: (sectionId: string) => void;
  selectSavedView: (viewId: string) => void;
  clear: () => void;
}

const initialState = {
  mode: "explore" as WorkspaceNavMode,
  selectedSectionId: null as string | null,
  selectedSavedViewId: null as string | null,
};

export const useWorkspaceNavStore = create<WorkspaceNavState>((set) => ({
  ...initialState,

  selectExplore: () =>
    set({
      mode: "explore",
      selectedSectionId: null,
      selectedSavedViewId: null,
    }),

  selectSection: (sectionId) =>
    set({
      mode: "section",
      selectedSectionId: sectionId,
      selectedSavedViewId: null,
    }),

  selectSavedView: (viewId) =>
    set({
      mode: "saved-view",
      selectedSectionId: null,
      selectedSavedViewId: viewId,
    }),

  clear: () => set({ ...initialState }),
}));
