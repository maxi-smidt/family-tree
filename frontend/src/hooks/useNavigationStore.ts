import { create } from "zustand";
import { type ViewId } from "@/lib/tabs";

// A pending request to focus the Map view on a specific location, raised
// from cross-view "show on map" actions (member sheet location fields,
// timeline event cards). `memberId` is optional context used to also select
// that member on the map (e.g. to draw their life path).
export interface MapFocusRequest {
  location: string;
  memberId?: string;
}

interface NavigationState {
  pendingView: ViewId | null;
  navigateTo: (view: ViewId) => void;
  clearPending: () => void;
  pendingMapFocus: MapFocusRequest | null;
  setMapFocus: (focus: MapFocusRequest) => void;
  clearMapFocus: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  pendingView: null,
  navigateTo: (view) => set({ pendingView: view }),
  clearPending: () => set({ pendingView: null }),
  pendingMapFocus: null,
  setMapFocus: (focus) => set({ pendingMapFocus: focus }),
  clearMapFocus: () => set({ pendingMapFocus: null }),
}));
