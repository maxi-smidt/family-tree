import { create } from "zustand";
import { type ViewId } from "@/lib/tabs";

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
