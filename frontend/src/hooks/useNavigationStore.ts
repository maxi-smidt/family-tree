import { create } from "zustand";

type ViewId =
  | "tree-view"
  | "list-view"
  | "gallery-view"
  | "timeline-view"
  | "activity-view"
  | "quality-report-view"
  | "database-management-view";

interface NavigationState {
  pendingView: ViewId | null;
  navigateTo: (view: ViewId) => void;
  clearPending: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  pendingView: null,
  navigateTo: (view) => set({ pendingView: view }),
  clearPending: () => set({ pendingView: null }),
}));
