import { create } from "zustand";
import { GeocodeResult, mapGeocodeFromDB } from "@/types/geocode";
import { TreeService } from "@/services/TreeService";
import { activeTreeId, isActiveTree } from "@/hooks/useTreeStore";
import { toast } from "sonner";
import i18n from "@/i18n/i18n";

interface GeocodeState {
  coords: Map<string, GeocodeResult>;
  // Number of geocode requests in flight. The backend resolves unknown
  // locations sequentially against Nominatim (>1s each), so consumers use
  // this to show a loading state instead of a misleading empty one.
  pendingCount: number;
  resolveLocations: (locations: string[]) => Promise<void>;
  getCoord: (location: string) => GeocodeResult | undefined;
  clear: () => void;
}

export const useGeocodeStore = create<GeocodeState>((set, get) => ({
  coords: new Map(),
  pendingCount: 0,

  resolveLocations: async (locations: string[]) => {
    const treeId = activeTreeId();
    if (!treeId) return;

    // Only request locations not already in cache
    const cached = get().coords;
    const unknown = [...new Set(locations)].filter((loc) => !cached.has(loc));
    if (unknown.length === 0) return;

    set((state) => ({ pendingCount: state.pendingCount + 1 }));
    try {
      const rows = await TreeService.geocodeLocations(treeId, unknown);
      if (!isActiveTree(treeId)) return;

      set((state) => {
        const next = new Map(state.coords);
        for (const row of rows) {
          next.set(row.query, mapGeocodeFromDB(row));
        }
        return { coords: next };
      });
    } catch (error) {
      console.error("Failed to resolve geocode locations:", error);
      toast.error(i18n.t("hooks.geocode.resolve-error"));
    } finally {
      // clear() may have reset the counter mid-flight; never go negative
      set((state) => ({ pendingCount: Math.max(0, state.pendingCount - 1) }));
    }
  },

  getCoord: (location: string) => get().coords.get(location),

  clear: () => set({ coords: new Map(), pendingCount: 0 }),
}));
